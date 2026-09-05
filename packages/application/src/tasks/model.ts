import type { Clock, IdGenerator, TaskId, UtcInstant } from '@jobhunter/domain';

/** 应用层使用的类型约束。 */
export type TaskStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';

/** 应用层使用的类型约束。 */
export type TaskErrorCategory =
  | 'rate_limited'
  | 'network_temporary'
  | 'io_temporary'
  | 'upstream_5xx'
  | 'parse_changed'
  | 'invalid_config'
  | 'validation_failed'
  | 'cancelled'
  | 'permanent';

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
  info(event: string, fields: TaskLogFields): void;
  warn(event: string, fields: TaskLogFields): void;
  error(event: string, fields: TaskLogFields): void;
}

/** 应用层数据结构或端口契约。 */
export interface TaskHandlerContext {
  readonly taskId?: TaskId;
  readonly signal: AbortSignal;
  readonly clock: Clock;
  readonly logger: TaskLogger;
  readonly services: Readonly<Record<string, unknown>>;
}

/** 应用层数据结构或端口契约。 */
export interface TaskHandler<TPayload, TOutput> {
  readonly taskType: string;
  readonly payloadSchema: RuntimeSchema<TPayload>;
  readonly outputSchema: RuntimeSchema<TOutput>;
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
  execute(context: TaskHandlerContext, payload: TPayload): Promise<TOutput>;
}

/** 应用层使用的类型约束。 */
export type RegisteredTaskHandler = TaskHandler<unknown, unknown>;

/** 应用层数据结构或端口契约。 */
export interface TaskRecord {
  readonly id: TaskId;
  readonly taskType: string;
  readonly payload: unknown;
  readonly status: TaskStatus;
  readonly priority: number;
  readonly idempotencyKey: string;
  readonly concurrencyKey: string | null;
  readonly scheduleId: string | null;
  readonly retryOfTaskId: TaskId | null;
  readonly attemptCount: number;
  readonly maxAttempts: number;
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
  readonly id: TaskId;
  readonly taskType: string;
  readonly payload: unknown;
  readonly priority: number;
  readonly idempotencyKey: string;
  readonly concurrencyKey: string | null;
  readonly scheduleId: string | null;
  readonly retryOfTaskId: TaskId | null;
  readonly maxAttempts: number;
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
  enqueue(input: PersistedTaskInput): EnqueueTaskResult;
  get(taskId: TaskId): TaskRecord | null;
  list(filter: TaskListFilter): readonly TaskRecord[];
  count(filter: Omit<TaskListFilter, 'limit' | 'offset'>): number;
  summary(now: UtcInstant): TaskQueueSummary;
  claim(input: {
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
