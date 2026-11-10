import type { Clock, IdGenerator, TaskId, UtcInstant } from '@jobhunter/common/domain';

/** 应用层使用的类型约束。 */
export type TaskStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';

/** 应用层使用的类型约束。 */
export type { TaskErrorCategory } from './errors.js';
import type { TaskErrorCategory } from './errors.js';

/** 应用层数据结构或端口契约。 */
export interface RuntimeSchema<TValue> {
  parse(value: unknown): TValue;
}

/** 应用层数据结构或端口契约。 */
export interface TaskLogFields {
  readonly [key: string]: unknown;
  readonly taskId?: string;
  readonly taskType?: string;
  readonly attempt?: number;
  readonly leaseOwner?: string;
  readonly durationMs?: number;
  readonly result?: string;
  readonly errorCategory?: TaskErrorCategory;
  readonly error?: unknown;
}

/** 应用层数据结构或端口契约。 */
export interface TaskLogger {
  debug?(event: string, fields: TaskLogFields): void;
  info(event: string, fields: TaskLogFields): void;
  warn(event: string, fields: TaskLogFields): void;
  error(event: string, fields: TaskLogFields): void;
}

/** 应用层数据结构或端口契约。 */
export interface TaskHandlerContext {
  /** 原子保存已提交的阶段进度；失去租约后必须拒绝写入。 */
  readonly checkpoint?: (result: unknown) => void;
  readonly taskId?: TaskId;
  /** 当前是第几次尝试；缺失表示执行环境未提供（如测试替身）。 */
  readonly attempt?: number;
  readonly signal: AbortSignal;
  readonly clock: Clock;
  readonly logger: TaskLogger;
  readonly services: Readonly<Record<string, unknown>>;
}

/** 应用层数据结构或端口契约。 */
export interface TaskHandler<TPayload, TOutput> {
  /** 有状态处理器声明固定执行域；同域会话始终归属同一线程。 */
  readonly executionAffinity?: string;
  /** 结果确认内存会话已释放时允许线程缩容。 */
  readonly releasesExecutionAffinity?: (output: TOutput) => boolean;
  readonly taskType: string;
  readonly payloadSchema: RuntimeSchema<TPayload>;
  readonly outputSchema: RuntimeSchema<TOutput>;
  /** 系统按任务类型配置的每轮尝试上限，不允许单条任务覆盖。 */
  readonly defaultMaxAttempts: number;
  readonly leaseDurationMs: number;
  /**
   * Use `complete` only when the handler's durable commit rejects cancellation requested before
   * that commit. A cancellation arriving after the handler returns is then too late to hide the
   * already-published business result. A resolver runs after output validation so handlers with
   * no-op results can keep the default cancellation-wins behavior.
   */
  readonly lateCancellationPolicy?:
    'cancel' | 'complete' | ((output: TOutput) => 'cancel' | 'complete');
  readonly concurrencyKey?: (payload: TPayload) => string | null;
  /** 根据已保存的部分结果构造恢复输入，返回值仍须通过 payloadSchema。 */
  readonly retryPayload?: (payload: unknown, result: unknown) => unknown;
  /** 仅用户手动重试调用，不用于 Worker 正常领取或自动恢复。 */
  readonly manualRetryPayload?: (payload: unknown, result: unknown) => unknown;
  execute(context: TaskHandlerContext, payload: TPayload): Promise<TOutput>;
}

/** 应用层使用的类型约束。 */
export type RegisteredTaskHandler = TaskHandler<unknown, unknown>;

/** 应用层数据结构或端口契约。 */
export interface TaskRecord {
  /** 内部阶段归属的主任务；只能通过主任务执行、重试或取消。 */
  readonly parentTaskId?: TaskId | null;
  readonly id: TaskId;
  readonly taskType: string;
  readonly payload: unknown;
  readonly status: TaskStatus;
  readonly priority: number;
  readonly idempotencyKey: string;
  readonly concurrencyKey: string | null;
  /** 任务累计领取次数，手动重试不清零。 */
  readonly attemptCount: number;
  readonly availableAt: UtcInstant;
  readonly leaseOwner: string | null;
  readonly leaseExpiresAt: UtcInstant | null;
  readonly lastHeartbeatAt: UtcInstant | null;
  readonly cancelRequestedAt: UtcInstant | null;
  readonly errorCategory: TaskErrorCategory | null;
  readonly errorSummary: string | null;
  readonly result?: unknown;
  readonly createdAt: UtcInstant;
  readonly startedAt: UtcInstant | null;
  readonly finishedAt: UtcInstant | null;
}

/** 应用层数据结构或端口契约。 */
export interface PersistedTaskInput {
  /** 异步子任务继承当前执行任务，供 CLI 精确推进工作流。 */
  readonly parentTaskId?: TaskId | null;
  readonly id: TaskId;
  readonly taskType: string;
  readonly payload: unknown;
  readonly priority: number;
  readonly idempotencyKey: string;
  readonly concurrencyKey: string | null;
  readonly availableAt: UtcInstant;
  readonly createdAt: UtcInstant;
}

/** 应用层使用的类型约束。 */
export type EnqueueTaskResult =
  | { readonly kind: 'enqueued'; readonly task: TaskRecord }
  | { readonly kind: 'idempotent'; readonly task: TaskRecord }
  | { readonly kind: 'concurrency_conflict'; readonly task: TaskRecord };

/** 应用层数据结构或端口契约。 */
export interface TaskRetryCoordinator {
  enqueueRetry(input: {
    readonly source: TaskRecord;
    readonly retry: PersistedTaskInput;
  }): EnqueueTaskResult;
}

/** 应用层数据结构或端口契约。 */
export interface TaskListFilter {
  /** 首页活动按实际结束时间排序，默认仍按创建时间。 */
  readonly order?: 'finished_desc';
  readonly statuses?: readonly TaskStatus[];
  readonly taskType?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/** 应用层数据结构或端口契约。 */
export interface TaskQueueSummary {
  readonly pending: number;
  readonly running: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly cancelled: number;
  readonly expiredLeases: number;
  readonly oldestPendingAgeMs: number | null;
}

/** 应用层使用的类型约束。 */
export type CancelTaskResult =
  | { readonly kind: 'cancelled'; readonly task: TaskRecord }
  | { readonly kind: 'cancel_requested'; readonly task: TaskRecord }
  | { readonly kind: 'already_cancelled'; readonly task: TaskRecord }
  | { readonly kind: 'not_cancellable'; readonly task: TaskRecord }
  | { readonly kind: 'not_found' };

/** 应用层数据结构或端口契约。 */
export interface HeartbeatResult {
  readonly ownsLease: boolean;
  readonly cancelRequested: boolean;
}

/** 应用层数据结构或端口契约。 */
export interface TaskCancellationNotifier {
  notifyCancellation(taskId: TaskId): void;
}

/** 应用层数据结构或端口契约。 */
export interface ScheduleRecord {
  readonly id: string;
  readonly scheduleKey: string;
  readonly taskType: string;
  readonly payload: unknown;
  readonly cronExpression: string;
  readonly timezone: string;
  readonly enabled: boolean;
  readonly nextRunAt: UtcInstant;
  readonly lastEnqueuedAt: UtcInstant | null;
  readonly createdAt: UtcInstant;
  readonly updatedAt: UtcInstant;
}

/** 应用层数据结构或端口契约。 */
export interface PersistedScheduleInput {
  readonly id: string;
  readonly scheduleKey: string;
  readonly taskType: string;
  readonly payload: unknown;
  readonly cronExpression: string;
  readonly timezone: string;
  readonly enabled: boolean;
  readonly nextRunAt: UtcInstant;
  readonly now: UtcInstant;
}

/** 应用层数据结构或端口契约。 */
export interface TaskQueue {
  /** 仅当前租约与尝试能保存进度，进度在取消及租约恢复时保留。 */
  checkpoint(
    taskId: TaskId,
    workerId: string,
    attempt: number,
    now: UtcInstant,
    result: unknown,
  ): boolean;
  enqueue(input: PersistedTaskInput): EnqueueTaskResult;
  /** 原子归档失败摘要并以同一身份重新入队，input.idempotencyKey 为本次操作令牌。 */
  retry(input: PersistedTaskInput): EnqueueTaskResult;
  get(taskId: TaskId): TaskRecord | null;
  list(filter: TaskListFilter): readonly TaskRecord[];
  count(filter: Omit<TaskListFilter, 'limit' | 'offset'>): number;
  /** 累计领取次数减最近手动重试日志中的起点，不修改累计审计次数。 */
  attemptsInCurrentRound(taskId: TaskId): number;
  summary(now: UtcInstant): TaskQueueSummary;
  claim(input: {
    readonly rootTaskIds?: readonly string[];
    readonly taskType: string;
    readonly workerId: string;
    readonly now: UtcInstant;
    readonly leaseDurationMsFor: (taskType: string) => number;
  }): TaskRecord | null;
  recoverExpired(now: UtcInstant): { readonly recovered: number; readonly exhausted: number };
  heartbeat(input: {
    readonly taskId: TaskId;
    readonly workerId: string;
    readonly now: UtcInstant;
    readonly leaseDurationMs: number;
  }): HeartbeatResult;
  complete(
    taskId: TaskId,
    workerId: string,
    finishedAt: UtcInstant,
    result?: unknown,
    options?: { readonly allowRequestedCancellation?: boolean },
  ): boolean;
  reschedule(input: {
    readonly result?: unknown;
    readonly taskId: TaskId;
    readonly workerId: string;
    readonly availableAt: UtcInstant;
    readonly occurredAt: UtcInstant;
    readonly category: TaskErrorCategory;
    readonly summary: string;
  }): boolean;
  fail(input: {
    readonly result?: unknown;
    readonly taskId: TaskId;
    readonly workerId: string;
    readonly finishedAt: UtcInstant;
    readonly category: TaskErrorCategory;
    readonly summary: string;
  }): boolean;
  markCancelled(taskId: TaskId, workerId: string, finishedAt: UtcInstant): boolean;
  cancel(taskId: TaskId, requestedAt: UtcInstant): CancelTaskResult;
  listSchedules(prefix: string): readonly ScheduleRecord[];
  upsertSchedule(input: PersistedScheduleInput): ScheduleRecord;
  dueSchedules(now: UtcInstant, limit: number): readonly ScheduleRecord[];
  commitScheduleOccurrence(input: {
    readonly scheduleId: string;
    readonly expectedNextRunAt: UtcInstant;
    readonly occurrenceAt: UtcInstant;
    readonly nextRunAt: UtcInstant;
    readonly task: PersistedTaskInput;
    readonly now: UtcInstant;
  }): EnqueueTaskResult | null;
}

/** 应用层数据结构或端口契约。 */
export interface TaskRuntimeDependencies {
  readonly queue: TaskQueue;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

/** 应用层数据结构或端口契约。 */
export interface RandomSource {
  next(): number;
}
