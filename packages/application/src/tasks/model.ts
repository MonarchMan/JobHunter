import type { Clock, IdGenerator, TaskId, UtcInstant } from '@jobhunter/domain';

export type TaskStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';

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

export interface RuntimeSchema<TValue> {
  parse(value: unknown): TValue;
}

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

export interface TaskLogger {
  info(event: string, fields: TaskLogFields): void;
  warn(event: string, fields: TaskLogFields): void;
  error(event: string, fields: TaskLogFields): void;
}

export interface TaskHandlerContext {
  readonly taskId?: TaskId;
  readonly signal: AbortSignal;
  readonly clock: Clock;
  readonly logger: TaskLogger;
  readonly services: Readonly<Record<string, unknown>>;
}

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
  execute(context: TaskHandlerContext, payload: TPayload): Promise<TOutput>;
}

export type RegisteredTaskHandler = TaskHandler<unknown, unknown>;

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

export type EnqueueTaskResult =
  | { readonly kind: 'enqueued'; readonly task: TaskRecord }
  | { readonly kind: 'idempotent'; readonly task: TaskRecord }
  | { readonly kind: 'concurrency_conflict'; readonly task: TaskRecord };

export interface TaskRetryCoordinator {
  enqueueRetry(input: {
    readonly source: TaskRecord;
    readonly retry: PersistedTaskInput;
  }): EnqueueTaskResult;
}

export interface TaskListFilter {
  readonly statuses?: readonly TaskStatus[];
  readonly taskType?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface TaskQueueSummary {
  readonly pending: number;
  readonly running: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly cancelled: number;
  readonly expiredLeases: number;
  readonly oldestPendingAgeMs: number | null;
}

export type CancelTaskResult =
  | { readonly kind: 'cancelled'; readonly task: TaskRecord }
  | { readonly kind: 'cancel_requested'; readonly task: TaskRecord }
  | { readonly kind: 'already_cancelled'; readonly task: TaskRecord }
  | { readonly kind: 'not_cancellable'; readonly task: TaskRecord }
  | { readonly kind: 'not_found' };

export interface HeartbeatResult {
  readonly ownsLease: boolean;
  readonly cancelRequested: boolean;
}

export interface TaskCancellationNotifier {
  notifyCancellation(taskId: TaskId): void;
}

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
    readonly taskId: TaskId;
    readonly workerId: string;
    readonly availableAt: UtcInstant;
    readonly occurredAt: UtcInstant;
    readonly category: TaskErrorCategory;
    readonly summary: string;
  }): boolean;
  fail(input: {
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

export interface TaskRuntimeDependencies {
  readonly queue: TaskQueue;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

export interface RandomSource {
  next(): number;
}
