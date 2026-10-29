import { contentHash, type RecruitmentScheduleFact } from '@jobhunter/domain';
import {
  MailConnectorError,
  type ExternalMailMessage,
  type ExternalMailMessageRef,
  type MailboxConfig,
  type MailboxConnector,
} from '@jobhunter/mail-core';
import { z } from 'zod';
import type { TaskHandler } from '../tasks/model.js';
import { TaskExecutionError } from '../tasks/retry-policy.js';
import type { RecruitmentMailClassificationResult } from './mail-classifier.js';
import { prepareRecruitmentMail } from './mail-content.js';
import type { MailSyncService } from './mail-sync-service.js';

/** 邮箱配置读取端口；配置文件仍由基础设施持有。 */
export interface MailboxConfigReader {
  list(): Promise<readonly MailboxConfig[]>;
}

/** 分类任务使用的最小邮件引用，不包含正文和完整发件地址。 */
export interface RecruitmentMailMessageRef extends ExternalMailMessageRef {
  readonly id: string;
}

/** 招聘邮件处理持久化端口；网络和模型调用完成后才进入短事务。 */
export interface RecruitmentMailProcessingRepository {
  findMessageRef(id: string): RecruitmentMailMessageRef | null;
  updateMessageStatus(input: {
    readonly id: string;
    readonly status: 'accepted' | 'needs_review' | 'ignored' | 'failed';
    readonly classifierKind: 'rules' | 'agent';
    readonly classifierVersion: string;
    readonly contentHash: string;
    readonly updatedAt: number;
  }): void;
  appendAcceptedApplicationEvent(input: {
    readonly applicationId: string;
    readonly externalApplicationKeyHash: string | null;
    readonly companyName: string;
    readonly roleTitle: string;
    readonly mailMessageRefId: string;
    readonly sourceContentHash: string;
    readonly classifierKind: 'rules' | 'agent';
    readonly classifierVersion: string;
    readonly agentRunId: string | null;
    readonly eventType: string;
    readonly effectiveAt: number;
    readonly receivedAt: number;
    readonly confidence: number;
    readonly schedule: RecruitmentScheduleFact | null;
    readonly location: string | null;
    readonly meetingUrl: string | null;
    readonly actionUrl: string | null;
    readonly payloadJson: string;
    readonly eventId: string;
    readonly now: number;
  }): boolean;
}

/** 分类任务只依赖邮件分类用例端口，测试和其他编排无需构造具体 Agent。 */
export interface RecruitmentMailClassificationPort {
  classify(
    message: ExternalMailMessage,
    signal: AbortSignal,
  ): Promise<RecruitmentMailClassificationResult>;
}

/** 稳定分类策略标识同时进入任务幂等键和邮件处理状态。 */
export const recruitmentMailPolicyVersion =
  'candidate-rules-v4+agent-v3-prompt-v5+schedule-identity-v2';

export const mailboxSyncTaskPayloadSchema = z.object({}).strict();
export const mailboxSyncTaskOutputSchema = z
  .object({
    mailboxes: z.number().int().nonnegative(),
    pages: z.number().int().nonnegative(),
    messages: z.number().int().nonnegative(),
  })
  .strict();
export const mailClassifyTaskPayloadSchema = z
  .object({ messageRefId: z.string().min(1).max(128) })
  .strict();
export const mailClassifyTaskOutputSchema = z
  .object({ status: z.enum(['accepted', 'needs_review', 'ignored']) })
  .strict();

/** 创建每日邮箱同步任务；扫描候选和增量同步属于同一任务的连续阶段。 */
export function createMailboxSyncTaskHandler(input: {
  readonly configs: MailboxConfigReader;
  readonly connectorFor: (config: MailboxConfig) => MailboxConnector | undefined;
  readonly service: MailSyncService;
}): TaskHandler<
  z.infer<typeof mailboxSyncTaskPayloadSchema>,
  z.infer<typeof mailboxSyncTaskOutputSchema>
> {
  return {
    taskType: 'mailbox.sync@v1',
    payloadSchema: mailboxSyncTaskPayloadSchema,
    outputSchema: mailboxSyncTaskOutputSchema,
    defaultMaxAttempts: 4,
    leaseDurationMs: 30 * 60_000,
    concurrencyKey: () => 'mailbox-sync',
    async execute(context) {
      // 1、读取启用邮箱；2、逐个执行发现、粗筛引用和游标提交；3、汇总批次结果。
      const mailboxes = (await input.configs.list()).filter((mailbox) => mailbox.enabled);
      let pages = 0;
      let messages = 0;
      let firstFailure: TaskExecutionError | null = null;
      for (const config of mailboxes) {
        const connector = input.connectorFor(config);
        if (!connector) {
          firstFailure ??= new TaskExecutionError(
            'invalid_config',
            'Mailbox connector is unavailable.',
          );
          continue;
        }
        try {
          // 2.a、同步服务内部先发现邮件引用，再保存引用、发布分类任务并推进游标。
          const result = await input.service.sync(
            config,
            connector,
            config.credentialRef,
            context.signal,
          );
          pages += result.pages;
          messages += result.messages;
        } catch (error) {
          const failure = mapMailConnectorError(error);
          if (context.signal.aborted || failure.category === 'cancelled') throw failure;
          // 2.b、单个邮箱的临时故障不能阻止本批次尝试其他邮箱；游标使重试安全重放。
          firstFailure ??= failure;
        }
      }
      if (firstFailure) throw firstFailure;
      return { mailboxes: mailboxes.length, pages, messages };
    },
  };
}

/** 创建单邮件分类任务；任务载荷仅包含内部引用 ID。 */
export function createMailClassifyTaskHandler(input: {
  readonly configs: MailboxConfigReader;
  readonly connectorFor: (config: MailboxConfig) => MailboxConnector | undefined;
  readonly classifier: RecruitmentMailClassificationPort;
  readonly repository: RecruitmentMailProcessingRepository;
  readonly createId: () => string;
}): TaskHandler<
  z.infer<typeof mailClassifyTaskPayloadSchema>,
  z.infer<typeof mailClassifyTaskOutputSchema>
> {
  return {
    taskType: 'mail.classify@v1',
    payloadSchema: mailClassifyTaskPayloadSchema,
    outputSchema: mailClassifyTaskOutputSchema,
    defaultMaxAttempts: 3,
    // 租约覆盖最多 30 秒正文读取与 180 秒 Agent 分类，留出本地提交余量。
    leaseDurationMs: 4 * 60_000,
    concurrencyKey: (payload) => `mail-classify:${payload.messageRefId}`,
    async execute(context, payload) {
      const reference = input.repository.findMessageRef(payload.messageRefId);
      if (!reference) {
        throw new TaskExecutionError('validation_failed', 'Mail message reference is unavailable.');
      }
      const config = (await input.configs.list()).find(
        (mailbox) => mailbox.mailboxKey === reference.mailboxKey,
      );
      const connector = config ? input.connectorFor(config) : undefined;
      if (!config || !config.enabled || !connector) {
        throw new TaskExecutionError('invalid_config', 'Mailbox configuration is unavailable.');
      }

      try {
        // 1、事务外只读取正文边界；2、规则筛选后按需调用模型；3、最后提交状态或事件。
        const message = await connector.fetchMessage(
          {
            mailboxKey: config.mailboxKey,
            credentialRef: config.credentialRef,
            signal: context.signal,
            timeoutMs: 30_000,
          },
          reference,
        );
        const prepared = prepareRecruitmentMail(message);
        const sourceContentHash = contentHash(prepared);
        const result = await input.classifier.classify(message, context.signal);
        // 3.a、取消若发生在外部调用结束前，必须先阻断业务提交，不能依赖连接器主动抛错。
        if (context.signal.aborted) {
          throw new TaskExecutionError('cancelled', 'Mailbox task was cancelled.');
        }
        const classification = result.classification;
        const now = context.clock.now();
        let status = classification.decision;

        // 3.b、普通流程事件仍要求完整申请身份；明确日程不因模板省略公司或岗位而丢失。
        if (
          status === 'accepted' &&
          classification.schedule === null &&
          (classification.companyName === null ||
            classification.roleTitle === null ||
            classification.applicationKey === null)
        ) {
          status = 'needs_review';
        }
        if (status === 'accepted') {
          // 3.c、日程模板缺失身份字段时使用显式占位，仅服务展示，不伪造邮件事实。
          const companyName = classification.companyName ?? '公司未注明';
          const roleTitle = classification.roleTitle ?? '未知';
          const applicationKey = classification.applicationKey;
          // 3.d、外部编号优先；公司和岗位齐全时稳定归组，否则按消息隔离，避免误合并申请。
          const applicationIdentityHash =
            applicationKey === null
              ? classification.companyName !== null && classification.roleTitle !== null
                ? contentHash({
                    mailboxKey: reference.mailboxKey,
                    identityKind: 'schedule_company_role',
                    companyName: normalizeApplicationIdentity(companyName),
                    roleTitle: normalizeApplicationIdentity(roleTitle),
                  })
                : contentHash({
                    mailboxKey: reference.mailboxKey,
                    identityKind: 'schedule_message',
                    messageRefId: reference.id,
                  })
              : contentHash({ mailboxKey: reference.mailboxKey, applicationKey });
          const externalApplicationKeyHash =
            applicationKey === null ? null : applicationIdentityHash;
          const applicationId = `mail-app-${applicationIdentityHash.slice(0, 40)}`;
          input.repository.appendAcceptedApplicationEvent({
            applicationId,
            externalApplicationKeyHash,
            companyName,
            roleTitle,
            mailMessageRefId: reference.id,
            sourceContentHash,
            classifierKind: classification.classifierKind,
            classifierVersion: classification.classifierVersion,
            agentRunId: result.agentRunId,
            eventType: classification.eventType,
            effectiveAt: classification.effectiveAt ?? reference.receivedAt,
            receivedAt: reference.receivedAt,
            confidence: classification.confidence,
            schedule: classification.schedule,
            location: classification.location,
            meetingUrl: classification.meetingUrl,
            actionUrl: classification.actionUrl,
            payloadJson: JSON.stringify({
              schedule: classification.schedule,
              location: classification.location,
              meetingUrl: classification.meetingUrl,
              actionUrl: classification.actionUrl,
              recruiterName: classification.recruiterName,
            }),
            eventId: input.createId(),
            now,
          });
        }
        input.repository.updateMessageStatus({
          id: reference.id,
          status,
          classifierKind: classification.classifierKind,
          classifierVersion: classification.classifierVersion,
          contentHash: sourceContentHash,
          updatedAt: now,
        });
        return { status };
      } catch (error) {
        if (error instanceof TaskExecutionError) throw error;
        if (context.signal.aborted) {
          throw new TaskExecutionError('cancelled', 'Mailbox task was cancelled.', {
            cause: error,
          });
        }
        throw mapMailConnectorError(error);
      }
    },
  };
}

/** 归一化派生申请身份，避免邮件模板中的大小写和空白差异拆分同一日程。 */
function normalizeApplicationIdentity(value: string): string {
  return value.trim().replace(/\s+/gu, ' ').toLocaleLowerCase('zh-CN');
}

/** 将连接器稳定错误映射为 Worker 重试类别，摘要不包含供应商响应或邮件数据。 */
function mapMailConnectorError(error: unknown): TaskExecutionError {
  if (!(error instanceof MailConnectorError)) {
    return new TaskExecutionError('permanent', 'Mailbox task failed.', { cause: error });
  }
  switch (error.category) {
    case 'rate_limited':
      return new TaskExecutionError('rate_limited', 'Mailbox provider rate limit reached.', {
        cause: error,
      });
    case 'network_temporary':
      return new TaskExecutionError('network_temporary', 'Mailbox network request failed.', {
        cause: error,
      });
    case 'upstream_5xx':
      return new TaskExecutionError('upstream_5xx', 'Mailbox provider is unavailable.', {
        cause: error,
      });
    case 'cancelled':
      return new TaskExecutionError('cancelled', 'Mailbox task was cancelled.', { cause: error });
    case 'authentication_required':
    case 'permission_denied':
    case 'invalid_config':
      return new TaskExecutionError('invalid_config', 'Mailbox authorization is unavailable.', {
        cause: error,
      });
    case 'parse_changed':
    case 'cursor_invalid':
      return new TaskExecutionError('parse_changed', 'Mailbox incremental state is invalid.', {
        cause: error,
      });
    case 'message_not_found':
    case 'payload_too_large':
    default:
      return new TaskExecutionError('permanent', 'Mailbox message cannot be processed.', {
        cause: error,
      });
  }
}
