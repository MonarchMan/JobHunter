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
export const recruitmentMailPolicyVersion = 'candidate-rules-v4+agent-v2-prompt-v4';

export const mailboxScanTaskPayloadSchema = z.object({}).strict();
export const mailboxScanTaskOutputSchema = z
  .object({ enabledMailboxes: z.number().int().nonnegative() })
  .strict();
export const mailboxSyncTaskPayloadSchema = z
  .object({ mailboxKey: z.string().min(1).max(128) })
  .strict();
export const mailboxSyncTaskOutputSchema = z
  .object({ pages: z.number().int().nonnegative(), messages: z.number().int().nonnegative() })
  .strict();
export const mailClassifyTaskPayloadSchema = z
  .object({ messageRefId: z.string().min(1).max(128) })
  .strict();
export const mailClassifyTaskOutputSchema = z
  .object({ status: z.enum(['accepted', 'needs_review', 'ignored']) })
  .strict();

/** 创建邮箱扫描任务；扫描只发布单邮箱任务，不接触凭据或正文。 */
export function createMailboxScanTaskHandler(input: {
  readonly configs: MailboxConfigReader;
  readonly enqueue: (mailbox: MailboxConfig) => void;
}): TaskHandler<
  z.infer<typeof mailboxScanTaskPayloadSchema>,
  z.infer<typeof mailboxScanTaskOutputSchema>
> {
  return {
    taskType: 'mailbox.scan@v1',
    payloadSchema: mailboxScanTaskPayloadSchema,
    outputSchema: mailboxScanTaskOutputSchema,
    defaultMaxAttempts: 3,
    leaseDurationMs: 60_000,
    concurrencyKey: () => 'mailbox-scan',
    async execute() {
      // 1、读取非敏感配置；2、只为启用连接发布邮箱级任务。
      const mailboxes = (await input.configs.list()).filter((mailbox) => mailbox.enabled);
      for (const mailbox of mailboxes) input.enqueue(mailbox);
      return { enabledMailboxes: mailboxes.length };
    },
  };
}

/** 创建单邮箱同步任务，连接器选择只依赖提供商无关端口。 */
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
    leaseDurationMs: 10 * 60_000,
    concurrencyKey: (payload) => `mailbox-sync:${payload.mailboxKey}`,
    async execute(context, payload) {
      const config = (await input.configs.list()).find(
        (mailbox) => mailbox.mailboxKey === payload.mailboxKey,
      );
      if (!config?.enabled) return { pages: 0, messages: 0 };
      const connector = input.connectorFor(config);
      if (!connector) {
        throw new TaskExecutionError('invalid_config', 'Mailbox connector is unavailable.');
      }
      try {
        // 1、连接器在事务外增量发现；2、服务保存引用并发布分类任务后推进游标。
        const result = await input.service.sync(
          config,
          connector,
          config.credentialRef,
          context.signal,
        );
        return { pages: result.pages, messages: result.messages };
      } catch (error) {
        throw mapMailConnectorError(error);
      }
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

        // 3.b、自动接受必须具备公司、岗位和稳定申请编号；仅凭名称不能安全合并多次申请。
        if (
          status === 'accepted' &&
          (classification.companyName === null ||
            classification.roleTitle === null ||
            classification.applicationKey === null)
        ) {
          status = 'needs_review';
        }
        if (status === 'accepted') {
          const companyName = classification.companyName;
          const roleTitle = classification.roleTitle;
          const applicationKey = classification.applicationKey;
          if (companyName === null || roleTitle === null || applicationKey === null) {
            throw new TaskExecutionError(
              'validation_failed',
              'Accepted mail lacks application identity.',
            );
          }
          // 3.c、申请编号只在当前邮箱连接内稳定，防止不同账号的相同外部编号被合并。
          const externalApplicationKeyHash = contentHash({
            mailboxKey: reference.mailboxKey,
            applicationKey,
          });
          const applicationId = `mail-app-${externalApplicationKeyHash.slice(0, 40)}`;
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
