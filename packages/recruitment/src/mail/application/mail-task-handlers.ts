import {
  AgentRuntimeError,
  agentDefinitionHash,
  type AgentExecution,
} from '@jobhunter/common/agent';
import { mapAgentRuntimeError } from '@jobhunter/common/tasks';
import { recruitmentMailAgentDefinition } from './mail-classifier.js';
import { contentHash } from '@jobhunter/common/domain';
import type { RecruitmentScheduleFact } from '@jobhunter/recruitment/domain';
import {
  MailConnectorError,
  type ExternalMailMessage,
  type ExternalMailMessageRef,
  type MailboxConfig,
  type MailboxConnector,
} from '@jobhunter/recruitment/mail-contracts';
import { z } from 'zod';
import { TaskExecutionError, type TaskHandler } from '@jobhunter/common/tasks';
import type { RecruitmentMailClassificationResult } from './mail-classifier.js';
import { prepareRecruitmentMail } from './mail-content.js';
import type { MailSyncService } from './mail-sync-service.js';

/** 邮箱配置读取端口；配置文件仍由基础设施持有。 */
export interface MailboxConfigReader {
  list(): Promise<readonly MailboxConfig[]>;
}

/** 分类阶段使用的最小邮件引用，附带已提交结论，供幂等重放判定。 */
export interface RecruitmentMailMessageRef extends ExternalMailMessageRef {
  readonly id: string;
  readonly processingStatus: string;
  readonly lastClassifierVersion: string | null;
}

/** 招聘邮件处理持久化端口；网络和模型调用完成后才进入短事务。 */
export interface RecruitmentMailProcessingRepository {
  findMessageRef(id: string): RecruitmentMailMessageRef | null;
  listPendingReferences(
    mailboxKey: string,
    afterId: string,
    policyVersion: string,
  ): readonly RecruitmentMailMessageRef[];
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

/** 由外部消息身份计算稳定内部引用 ID；实现由持久化层提供，应用层不经手哈希细节。 */
export type MailMessageRefIdOf = (mailboxKey: string, externalMessageKey: string) => string;

/** 分类阶段只依赖邮件分类用例端口，测试和其他编排无需构造具体 Agent。 */
export interface RecruitmentMailClassificationPort {
  classify(
    message: ExternalMailMessage,
    signal: AbortSignal,
    execution?: AgentExecution,
  ): Promise<RecruitmentMailClassificationResult>;
}

/** 稳定分类策略标识同时进入邮件重放判定和邮件处理状态。 */
export const recruitmentMailPolicyVersion = contentHash({
  rules: 'candidate-rules-v4',
  schedule: 'schedule-identity-v2',
  agent: agentDefinitionHash(recruitmentMailAgentDefinition),
});

export const mailboxSyncTaskPayloadSchema = z
  .object({
    mailboxKey: z.string().min(1).max(128),
    // 崩溃恢复注入的已完成页游标集合；计划投递不携带。
    resume: z
      .object({ completedCursors: z.array(z.unknown()) })
      .strict()
      .optional(),
  })
  .strict();
export const mailboxSyncTaskOutputSchema = z
  .object({
    mailboxKey: z.string(),
    pages: z.number().int().nonnegative(),
    messages: z.number().int().nonnegative(),
    classified: z.number().int().nonnegative(),
  })
  .strict();

/** 依据已保存的检查点构造恢复输入；无有效检查点时整任务重跑。 */
function withResumeFromCheckpoint(value: unknown, result: unknown): unknown {
  const parsed = mailboxSyncTaskPayloadSchema.safeParse(value);
  if (!parsed.success) return value;
  const checkpoint = z.object({ completedCursors: z.array(z.unknown()) }).safeParse(result);
  if (!checkpoint.success) return value;
  return { mailboxKey: parsed.data.mailboxKey, resume: checkpoint.data };
}

/**
 * 单邮件分类用例（同步任务第二阶段）：正文读取、规则筛选、模型分类与结论提交。
 * 单封失败映射为稳定错误类别向上抛出，由页内串行循环决定是否继续。
 */
export class MailClassificationService {
  readonly #configs: MailboxConfigReader;
  readonly #connectorFor: (config: MailboxConfig) => MailboxConnector | undefined;
  readonly #classifier: RecruitmentMailClassificationPort;
  readonly #repository: RecruitmentMailProcessingRepository;
  readonly #messageRefIdOf: MailMessageRefIdOf;
  readonly #createId: () => string;

  public constructor(input: {
    readonly configs: MailboxConfigReader;
    readonly connectorFor: (config: MailboxConfig) => MailboxConnector | undefined;
    readonly classifier: RecruitmentMailClassificationPort;
    readonly repository: RecruitmentMailProcessingRepository;
    readonly messageRefIdOf: MailMessageRefIdOf;
    readonly createId: () => string;
  }) {
    this.#configs = input.configs;
    this.#connectorFor = input.connectorFor;
    this.#classifier = input.classifier;
    this.#repository = input.repository;
    this.#messageRefIdOf = input.messageRefIdOf;
    this.#createId = input.createId;
  }

  /** 分页查询持久化积压，包含旧分类队列取消后尚未提交的引用。 */
  public pending(mailboxKey: string, afterId: string): readonly RecruitmentMailMessageRef[] {
    return this.#repository.listPendingReferences(
      mailboxKey,
      afterId,
      recruitmentMailPolicyVersion,
    );
  }

  /** 处理一封邮件；返回提交的处理结论，已按当前策略提交的引用返回 null。 */
  public async classifyOne(input: {
    readonly taskId?: string;
    readonly reference: ExternalMailMessageRef;
    readonly signal: AbortSignal;
    readonly now: () => number;
  }): Promise<'accepted' | 'needs_review' | 'ignored' | null> {
    const id = this.#messageRefIdOf(input.reference.mailboxKey, input.reference.externalMessageKey);
    const stored = this.#repository.findMessageRef(id);
    // 1、幂等判定：已按当前策略提交终态结论的引用不再重复调用模型。
    if (
      stored?.contentVersion === input.reference.contentVersion &&
      stored.lastClassifierVersion === recruitmentMailPolicyVersion &&
      (stored.processingStatus === 'accepted' ||
        stored.processingStatus === 'needs_review' ||
        stored.processingStatus === 'ignored')
    ) {
      return null;
    }
    const config = (await this.#configs.list()).find(
      (mailbox) => mailbox.mailboxKey === input.reference.mailboxKey && mailbox.enabled,
    );
    const connector = config ? this.#connectorFor(config) : undefined;
    if (!config || !connector) {
      throw new TaskExecutionError('invalid_config', 'Mailbox configuration is unavailable.');
    }
    const reference: ExternalMailMessageRef & { id: string } = { ...input.reference, id };
    let sourceContentHash = contentHash({
      mailboxKey: reference.mailboxKey,
      key: reference.externalMessageKey,
      version: reference.contentVersion,
    });
    try {
      // 2、事务外只读取正文边界；3、规则筛选后按需调用模型；4、最后提交状态或事件。
      const message = await connector.fetchMessage(
        {
          mailboxKey: config.mailboxKey,
          credentialRef: config.credentialRef,
          signal: input.signal,
          timeoutMs: 30_000,
        },
        reference,
      );
      const prepared = prepareRecruitmentMail(message);
      sourceContentHash = contentHash(prepared);
      const execution = input.taskId
        ? {
            taskId: input.taskId,
            stepKey: 'mail.classify',
            resourceKey: JSON.stringify([
              reference.mailboxKey,
              reference.externalMessageKey,
              reference.contentVersion,
            ]),
          }
        : undefined;
      const result = await this.#classifier.classify(message, input.signal, execution);
      // 4.a、取消若发生在外部调用结束前，必须先阻断业务提交，不能依赖连接器主动抛错。
      if (input.signal.aborted) {
        throw new TaskExecutionError('cancelled', 'Mailbox task was cancelled.');
      }
      const latest = this.#repository.findMessageRef(id);
      if (latest && latest.contentVersion !== reference.contentVersion)
        throw new TaskExecutionError(
          'network_temporary',
          'Mailbox message changed during classification.',
        );
      const classification = result.classification;
      const now = input.now();
      let status = classification.decision;

      // 4.b、普通流程事件仍要求完整申请身份；明确日程不因模板省略公司或岗位而丢失。
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
        // 4.c、日程模板缺失身份字段时使用显式占位，仅服务展示，不伪造邮件事实。
        const companyName = classification.companyName ?? '公司未注明';
        const roleTitle = classification.roleTitle ?? '未知';
        const applicationKey = classification.applicationKey;
        // 4.d、外部编号优先；公司和岗位齐全时稳定归组，否则按消息隔离，避免误合并申请。
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
        const externalApplicationKeyHash = applicationKey === null ? null : applicationIdentityHash;
        const applicationId = `mail-app-${applicationIdentityHash.slice(0, 40)}`;
        this.#repository.appendAcceptedApplicationEvent({
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
          eventId: this.#createId(),
          now,
        });
      }
      this.#repository.updateMessageStatus({
        id: reference.id,
        status,
        classifierKind: classification.classifierKind,
        classifierVersion: recruitmentMailPolicyVersion,
        contentHash: sourceContentHash,
        updatedAt: now,
      });
      return status;
    } catch (error) {
      if (input.signal.aborted) {
        throw new TaskExecutionError('cancelled', 'Mailbox task was cancelled.', { cause: error });
      }
      const mapped =
        error instanceof TaskExecutionError
          ? error
          : error instanceof AgentRuntimeError
            ? mapAgentRuntimeError(error, '邮件分类')
            : mapMailConnectorError(error);
      if (
        mapped.category !== 'cancelled' &&
        this.#repository.findMessageRef(id)?.contentVersion === reference.contentVersion
      )
        this.#repository.updateMessageStatus({
          id,
          status: 'failed',
          classifierKind: 'rules',
          classifierVersion: recruitmentMailPolicyVersion,
          contentHash: sourceContentHash,
          updatedAt: input.now(),
        });
      throw mapped;
    }
  }
}

/** 创建单个邮箱的同步任务：阶段一发现引用，阶段二串行分类（ADR-0066）。 */
export function createMailboxSyncTaskHandler(input: {
  readonly configs: MailboxConfigReader;
  readonly connectorFor: (config: MailboxConfig) => MailboxConnector | undefined;
  readonly service: MailSyncService;
  readonly classification: MailClassificationService;
}): TaskHandler<
  z.infer<typeof mailboxSyncTaskPayloadSchema>,
  z.infer<typeof mailboxSyncTaskOutputSchema>
> {
  return {
    taskType: 'mailbox.sync@v1',
    payloadSchema: mailboxSyncTaskPayloadSchema,
    outputSchema: mailboxSyncTaskOutputSchema,
    defaultMaxAttempts: 4,
    // 租约为单次续租窗口，Worker 心跳在扫描与分类整段执行期间持续续租。
    leaseDurationMs: 30 * 60_000,
    concurrencyKey: (payload) => `mailbox-sync:${payload.mailboxKey}`,
    retryPayload: withResumeFromCheckpoint,
    manualRetryPayload: withResumeFromCheckpoint,
    async execute(context, payload) {
      // 1、定位对应邮箱配置；2、阶段一逐页发现引用；3、阶段二每页串行分类并落检查点。
      const config = (await input.configs.list()).find(
        (mailbox) => mailbox.mailboxKey === payload.mailboxKey && mailbox.enabled,
      );
      const connector = config ? input.connectorFor(config) : undefined;
      if (!config || !connector) {
        throw new TaskExecutionError('invalid_config', 'Mailbox configuration is unavailable.');
      }
      const completedKeys = new Set(
        (payload.resume?.completedCursors ?? []).map((cursor) => stableCursorKey(cursor)),
      );
      const completedCursors: unknown[] = [...(payload.resume?.completedCursors ?? [])];
      let classified = 0;
      let backlogError: Error | undefined;
      const processReference = async (reference: ExternalMailMessageRef): Promise<void> => {
        context.signal.throwIfAborted();
        const outcome = await input.classification.classifyOne({
          reference,
          signal: context.signal,
          now: () => context.clock.now(),
          ...(context.taskId ? { taskId: context.taskId } : {}),
        });
        if (outcome !== null) classified++;
      };
      // 1.a、历史积压独立于供应商游标重放，分页前进避免本轮重复尝试失败引用。
      let afterId = '';
      for (;;) {
        const pending = input.classification.pending(config.mailboxKey, afterId);
        if (!pending.length) break;
        for (const ref of pending) {
          try {
            await processReference(ref);
          } catch (error) {
            context.signal.throwIfAborted();
            if (error instanceof TaskExecutionError && error.category === 'cancelled') throw error;
            backlogError ??=
              error instanceof Error
                ? error
                : new TaskExecutionError('permanent', 'Mailbox backlog failed.');
          }
          afterId = ref.id;
        }
      }
      const result = await input.service.sync(
        config,
        connector,
        config.credentialRef,
        context.signal,
        {
          shouldSkipPage: (nextCursor) => completedKeys.has(stableCursorKey(nextCursor)),
          processPage: async (refs) => {
            // 2.a、处理同页其他邮件后才抛错，失败页不能提交游标。
            let failure: Error | undefined;
            for (const reference of refs) {
              try {
                await processReference(reference);
              } catch (error) {
                context.signal.throwIfAborted();
                if (error instanceof TaskExecutionError && error.category === 'cancelled')
                  throw error;
                failure ??=
                  error instanceof Error
                    ? error
                    : new TaskExecutionError('permanent', 'Mailbox page failed.');
              }
            }
            if (failure) throw failure;
          },
          onPageCommitted: (cursor) => {
            completedKeys.add(stableCursorKey(cursor));
            completedCursors.push(cursor);
            context.checkpoint?.({ completedCursors: [...completedCursors] });
          },
        },
      );
      if (backlogError) throw backlogError;
      return {
        mailboxKey: payload.mailboxKey,
        pages: result.pages,
        messages: result.messages,
        classified,
      };
    },
  };
}

/** 不透明游标需要稳定身份以判定页是否已完成；键序无关的规范化序列化避免误判。 */
function stableCursorKey(cursor: unknown): string {
  return JSON.stringify(sortForStableKey(cursor));
}

function sortForStableKey(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortForStableKey);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => (left < right ? -1 : 1))
        .map(([key, entry]) => [key, sortForStableKey(entry)]),
    );
  }
  return value;
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
