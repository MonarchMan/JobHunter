import type {
  CancelTaskResult,
  EnqueueTaskResult,
  HeartbeatResult,
  PersistedScheduleInput,
  PersistedTaskInput,
  ScheduleRecord,
  TaskErrorCategory,
  TaskListFilter,
  TaskQueue,
  TaskQueueSummary,
  TaskRecord,
  TaskStatus,
} from '@jobhunter/application';
import {
  canonicalJson,
  parseId,
  utcInstant,
  type TaskId,
  type UtcInstant,
} from '@jobhunter/domain';
import type Database from 'better-sqlite3';

interface TaskRow {
  readonly id: string;
  readonly task_type: string;
  readonly payload_json: string;
  readonly status: TaskStatus;
  readonly priority: number;
  readonly idempotency_key: string;
  readonly concurrency_key: string | null;
  readonly schedule_id: string | null;
  readonly retry_of_task_id: string | null;
  readonly attempt_count: number;
  readonly max_attempts: number;
  readonly available_at: number;
  readonly lease_owner: string | null;
  readonly lease_expires_at: number | null;
  readonly last_heartbeat_at: number | null;
  readonly cancel_requested_at: number | null;
  readonly error_category: TaskErrorCategory | null;
  readonly error_summary: string | null;
  readonly created_at: number;
  readonly started_at: number | null;
  readonly finished_at: number | null;
}

interface ScheduleRow {
  readonly id: string;
  readonly schedule_key: string;
  readonly task_type: string;
  readonly payload_json: string;
  readonly cron_expression: string;
  readonly timezone: string;
  readonly enabled: number;
  readonly next_run_at: number;
  readonly last_enqueued_at: number | null;
  readonly created_at: number;
  readonly updated_at: number;
}

interface QueueSummaryRow {
  readonly pending: number;
  readonly running: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly cancelled: number;
  readonly expired_leases: number;
  readonly oldest_pending_at: number | null;
}

interface ClaimTaskInput {
  readonly taskType: string;
  readonly workerId: string;
  readonly now: UtcInstant;
  readonly leaseDurationMsFor: (taskType: string) => number;
}

interface CommitScheduleInput {
  readonly scheduleId: string;
  readonly expectedNextRunAt: UtcInstant;
  readonly occurrenceAt: UtcInstant;
  readonly nextRunAt: UtcInstant;
  readonly task: PersistedTaskInput;
  readonly now: UtcInstant;
}

function nullableInstant(value: number | null): UtcInstant | null {
  return value === null ? null : utcInstant(value);
}

function taskFromRow(row: TaskRow): TaskRecord {
  return {
    id: parseId(row.id, 'Task'),
    taskType: row.task_type,
    payload: JSON.parse(row.payload_json) as unknown,
    status: row.status,
    priority: row.priority,
    idempotencyKey: row.idempotency_key,
    concurrencyKey: row.concurrency_key,
    scheduleId: row.schedule_id,
    retryOfTaskId: row.retry_of_task_id === null ? null : parseId(row.retry_of_task_id, 'Task'),
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    availableAt: utcInstant(row.available_at),
    leaseOwner: row.lease_owner,
    leaseExpiresAt: nullableInstant(row.lease_expires_at),
    lastHeartbeatAt: nullableInstant(row.last_heartbeat_at),
    cancelRequestedAt: nullableInstant(row.cancel_requested_at),
    errorCategory: row.error_category,
    errorSummary: row.error_summary,
    createdAt: utcInstant(row.created_at),
    startedAt: nullableInstant(row.started_at),
    finishedAt: nullableInstant(row.finished_at),
  };
}

function scheduleFromRow(row: ScheduleRow): ScheduleRecord {
  return {
    id: row.id,
    scheduleKey: row.schedule_key,
    taskType: row.task_type,
    payload: JSON.parse(row.payload_json) as unknown,
    cronExpression: row.cron_expression,
    timezone: row.timezone,
    enabled: row.enabled === 1,
    nextRunAt: utcInstant(row.next_run_at),
    lastEnqueuedAt: nullableInstant(row.last_enqueued_at),
    createdAt: utcInstant(row.created_at),
    updatedAt: utcInstant(row.updated_at),
  };
}

const TASK_COLUMNS = `
  id, task_type, payload_json, status, priority, idempotency_key, concurrency_key,
  schedule_id, retry_of_task_id, attempt_count, max_attempts, available_at,
  lease_owner, lease_expires_at, last_heartbeat_at, cancel_requested_at,
  error_category, error_summary, created_at, started_at, finished_at`;

const SCHEDULE_COLUMNS = `
  id, schedule_key, task_type, payload_json, cron_expression, timezone, enabled,
  next_run_at, last_enqueued_at, created_at, updated_at`;

export class SqliteTaskRepository implements TaskQueue {
  readonly #client: Database.Database;
  readonly #claimTransaction: (input: {
    readonly taskType: string;
    readonly workerId: string;
    readonly now: UtcInstant;
    readonly leaseDurationMsFor: (taskType: string) => number;
  }) => TaskRecord | null;
  readonly #recoveryTransaction: (now: UtcInstant) => {
    readonly recovered: number;
    readonly exhausted: number;
  };
  readonly #cancelTransaction: (taskId: TaskId, requestedAt: UtcInstant) => CancelTaskResult;
  readonly #scheduleTransaction: (input: {
    readonly scheduleId: string;
    readonly expectedNextRunAt: UtcInstant;
    readonly occurrenceAt: UtcInstant;
    readonly nextRunAt: UtcInstant;
    readonly task: PersistedTaskInput;
    readonly now: UtcInstant;
  }) => EnqueueTaskResult | null;

  public constructor(client: Database.Database) {
    this.#client = client;
    const claimTransaction = client.transaction((input: ClaimTaskInput) =>
      this.#claimInside(input),
    );
    this.#claimTransaction = (input) => claimTransaction.immediate(input);
    const recoveryTransaction = client.transaction((now: UtcInstant) =>
      this.#recoverExpiredInside(now),
    );
    this.#recoveryTransaction = (now) => recoveryTransaction.immediate(now);
    const cancelTransaction = client.transaction((taskId: TaskId, requestedAt: UtcInstant) =>
      this.#cancelInside(taskId, requestedAt),
    );
    this.#cancelTransaction = (taskId, requestedAt) =>
      cancelTransaction.immediate(taskId, requestedAt);
    const scheduleTransaction = client.transaction((input: CommitScheduleInput) =>
      this.#commitScheduleOccurrenceInside(input),
    );
    this.#scheduleTransaction = (input) => scheduleTransaction.immediate(input);
  }

  #insert(input: PersistedTaskInput): TaskRecord {
    const row = this.#client
      .prepare(
        `INSERT INTO tasks
         (id, task_type, payload_json, status, priority, idempotency_key, concurrency_key,
          schedule_id, retry_of_task_id, attempt_count, max_attempts, available_at,
          lease_owner, lease_expires_at, last_heartbeat_at, cancel_requested_at,
          error_category, error_summary, created_at, started_at, finished_at)
         VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, 0, ?, ?, NULL, NULL, NULL, NULL,
                 NULL, NULL, ?, NULL, NULL)
         RETURNING ${TASK_COLUMNS}`,
      )
      .get(
        input.id,
        input.taskType,
        canonicalJson(input.payload),
        input.priority,
        input.idempotencyKey,
        input.concurrencyKey,
        input.scheduleId,
        input.retryOfTaskId,
        input.maxAttempts,
        input.availableAt,
        input.createdAt,
      ) as TaskRow;
    return taskFromRow(row);
  }

  #resolveInsertConflict(input: PersistedTaskInput, error: unknown): EnqueueTaskResult {
    const idempotent = this.#findByIdempotencyKey(input.idempotencyKey);
    if (idempotent) return { kind: 'idempotent', task: idempotent };
    if (input.concurrencyKey) {
      const active = this.#findActiveByConcurrencyKey(input.concurrencyKey);
      if (active) return { kind: 'concurrency_conflict', task: active };
    }
    throw error;
  }

  public enqueue(input: PersistedTaskInput): EnqueueTaskResult {
    try {
      return { kind: 'enqueued', task: this.#insert(input) };
    } catch (error) {
      return this.#resolveInsertConflict(input, error);
    }
  }

  #findByIdempotencyKey(idempotencyKey: string): TaskRecord | null {
    const row = this.#client
      .prepare(`SELECT ${TASK_COLUMNS} FROM tasks WHERE idempotency_key = ?`)
      .get(idempotencyKey) as TaskRow | undefined;
    return row ? taskFromRow(row) : null;
  }

  #findActiveByConcurrencyKey(concurrencyKey: string): TaskRecord | null {
    const row = this.#client
      .prepare(
        `SELECT ${TASK_COLUMNS} FROM tasks
         WHERE concurrency_key = ? AND status IN ('pending', 'running') LIMIT 1`,
      )
      .get(concurrencyKey) as TaskRow | undefined;
    return row ? taskFromRow(row) : null;
  }

  public get(taskId: TaskId): TaskRecord | null {
    const row = this.#client
      .prepare(`SELECT ${TASK_COLUMNS} FROM tasks WHERE id = ?`)
      .get(taskId) as TaskRow | undefined;
    return row ? taskFromRow(row) : null;
  }

  public list(filter: TaskListFilter): readonly TaskRecord[] {
    const conditions: string[] = [];
    const parameters: unknown[] = [];
    if (filter.statuses && filter.statuses.length > 0) {
      const valid = new Set<TaskStatus>(['pending', 'running', 'succeeded', 'failed', 'cancelled']);
      if (filter.statuses.some((status) => !valid.has(status))) {
        throw new TypeError('Task status filter is invalid.');
      }
      conditions.push(`status IN (${filter.statuses.map(() => '?').join(', ')})`);
      parameters.push(...filter.statuses);
    }
    if (filter.taskType) {
      conditions.push('task_type = ?');
      parameters.push(filter.taskType);
    }
    const limit = filter.limit ?? 100;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
      throw new TypeError('Task list limit is invalid.');
    }
    const offset = filter.offset ?? 0;
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw new TypeError('Task list offset is invalid.');
    }
    const rows = this.#client
      .prepare(
        `SELECT ${TASK_COLUMNS} FROM tasks
         ${conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''}
         ORDER BY created_at DESC, id ASC LIMIT ? OFFSET ?`,
      )
      .all(...parameters, limit, offset) as TaskRow[];
    return rows.map(taskFromRow);
  }

  public count(filter: Omit<TaskListFilter, 'limit' | 'offset'>): number {
    const conditions: string[] = [];
    const parameters: unknown[] = [];
    if (filter.statuses && filter.statuses.length > 0) {
      const valid = new Set<TaskStatus>(['pending', 'running', 'succeeded', 'failed', 'cancelled']);
      if (filter.statuses.some((status) => !valid.has(status))) {
        throw new TypeError('Task status filter is invalid.');
      }
      conditions.push(`status IN (${filter.statuses.map(() => '?').join(', ')})`);
      parameters.push(...filter.statuses);
    }
    if (filter.taskType) {
      conditions.push('task_type = ?');
      parameters.push(filter.taskType);
    }
    const row = this.#client
      .prepare<unknown[], { readonly total: number }>(
        `SELECT COUNT(*) AS total FROM tasks
         ${conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''}`,
      )
      .get(...parameters) as { readonly total: number };
    return row.total;
  }

  public summary(now: UtcInstant): TaskQueueSummary {
    const row = this.#client
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) AS pending,
           COALESCE(SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END), 0) AS running,
           COALESCE(SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END), 0) AS succeeded,
           COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failed,
           COALESCE(SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END), 0) AS cancelled,
           COALESCE(SUM(CASE WHEN status = 'running' AND lease_expires_at <= ? THEN 1 ELSE 0 END), 0)
             AS expired_leases,
           MIN(CASE WHEN status = 'pending' THEN created_at END) AS oldest_pending_at
         FROM tasks`,
      )
      .get(now) as QueueSummaryRow;
    return {
      pending: row.pending,
      running: row.running,
      succeeded: row.succeeded,
      failed: row.failed,
      cancelled: row.cancelled,
      expiredLeases: row.expired_leases,
      oldestPendingAgeMs:
        row.oldest_pending_at === null ? null : Math.max(0, now - row.oldest_pending_at),
    };
  }

  #recoverExpiredInside(now: UtcInstant): {
    readonly recovered: number;
    readonly exhausted: number;
  } {
    this.#client
      .prepare(
        `UPDATE tasks SET status = 'cancelled', finished_at = ?, lease_owner = NULL,
           lease_expires_at = NULL, last_heartbeat_at = NULL,
           error_category = 'cancelled', error_summary = 'Cancellation recovered after lease expiry.'
         WHERE status = 'running' AND lease_expires_at <= ? AND cancel_requested_at IS NOT NULL`,
      )
      .run(now, now);
    const exhausted = this.#client
      .prepare(
        `UPDATE tasks SET status = 'failed', finished_at = ?, lease_owner = NULL,
           lease_expires_at = NULL, last_heartbeat_at = NULL,
           error_category = 'permanent', error_summary = 'Lease expired after final attempt.'
         WHERE status = 'running' AND lease_expires_at <= ? AND cancel_requested_at IS NULL
           AND attempt_count >= max_attempts`,
      )
      .run(now, now).changes;
    const recovered = this.#client
      .prepare(
        `UPDATE tasks SET status = 'pending', available_at = ?, lease_owner = NULL,
           lease_expires_at = NULL, last_heartbeat_at = NULL
         WHERE status = 'running' AND lease_expires_at <= ? AND cancel_requested_at IS NULL
           AND attempt_count < max_attempts`,
      )
      .run(now, now).changes;
    return { recovered, exhausted };
  }

  public recoverExpired(now: UtcInstant): {
    readonly recovered: number;
    readonly exhausted: number;
  } {
    return this.#recoveryTransaction(now);
  }

  #claimInside(input: {
    readonly taskType: string;
    readonly workerId: string;
    readonly now: UtcInstant;
    readonly leaseDurationMsFor: (taskType: string) => number;
  }): TaskRecord | null {
    this.#recoverExpiredInside(input.now);
    const candidate = this.#client
      .prepare(
        `SELECT id, task_type FROM tasks
         WHERE task_type = ? AND status = 'pending' AND available_at <= ?
         ORDER BY priority DESC, available_at ASC, created_at ASC, id ASC LIMIT 1`,
      )
      .get(input.taskType, input.now) as
      { readonly id: string; readonly task_type: string } | undefined;
    if (!candidate) return null;
    const leaseDurationMs = input.leaseDurationMsFor(candidate.task_type);
    if (!Number.isSafeInteger(leaseDurationMs) || leaseDurationMs < 1_000) {
      throw new TypeError(`Invalid lease duration for task type: ${candidate.task_type}`);
    }
    const row = this.#client
      .prepare(
        `UPDATE tasks SET status = 'running', lease_owner = ?, lease_expires_at = ?,
           last_heartbeat_at = ?, attempt_count = attempt_count + 1,
           started_at = COALESCE(started_at, ?), error_category = NULL, error_summary = NULL
         WHERE id = ? AND status = 'pending'
         RETURNING ${TASK_COLUMNS}`,
      )
      .get(input.workerId, input.now + leaseDurationMs, input.now, input.now, candidate.id) as
      TaskRow | undefined;
    return row ? taskFromRow(row) : null;
  }

  public claim(input: {
    readonly taskType: string;
    readonly workerId: string;
    readonly now: UtcInstant;
    readonly leaseDurationMsFor: (taskType: string) => number;
  }): TaskRecord | null {
    return this.#claimTransaction(input);
  }

  public heartbeat(input: {
    readonly taskId: TaskId;
    readonly workerId: string;
    readonly now: UtcInstant;
    readonly leaseDurationMs: number;
  }): HeartbeatResult {
    const row = this.#client
      .prepare(
        `UPDATE tasks SET lease_expires_at = ?, last_heartbeat_at = ?
         WHERE id = ? AND status = 'running' AND lease_owner = ? AND lease_expires_at > ?
         RETURNING cancel_requested_at`,
      )
      .get(
        input.now + input.leaseDurationMs,
        input.now,
        input.taskId,
        input.workerId,
        input.now,
      ) as { readonly cancel_requested_at: number | null } | undefined;
    return {
      ownsLease: Boolean(row),
      cancelRequested: row ? row.cancel_requested_at !== null : false,
    };
  }

  public complete(taskId: TaskId, workerId: string, finishedAt: UtcInstant): boolean {
    return (
      this.#client
        .prepare(
          `UPDATE tasks SET status = 'succeeded', finished_at = ?, lease_owner = NULL,
             lease_expires_at = NULL, last_heartbeat_at = NULL
           WHERE id = ? AND status = 'running' AND lease_owner = ?
             AND cancel_requested_at IS NULL AND lease_expires_at > ?`,
        )
        .run(finishedAt, taskId, workerId, finishedAt).changes === 1
    );
  }

  public reschedule(input: {
    readonly taskId: TaskId;
    readonly workerId: string;
    readonly availableAt: UtcInstant;
    readonly occurredAt: UtcInstant;
    readonly category: TaskErrorCategory;
    readonly summary: string;
  }): boolean {
    return (
      this.#client
        .prepare(
          `UPDATE tasks SET status = 'pending', available_at = ?, lease_owner = NULL,
             lease_expires_at = NULL, last_heartbeat_at = NULL,
             error_category = ?, error_summary = ?
           WHERE id = ? AND status = 'running' AND lease_owner = ? AND lease_expires_at > ?`,
        )
        .run(
          input.availableAt,
          input.category,
          input.summary,
          input.taskId,
          input.workerId,
          input.occurredAt,
        ).changes === 1
    );
  }

  public fail(input: {
    readonly taskId: TaskId;
    readonly workerId: string;
    readonly finishedAt: UtcInstant;
    readonly category: TaskErrorCategory;
    readonly summary: string;
  }): boolean {
    return (
      this.#client
        .prepare(
          `UPDATE tasks SET status = 'failed', finished_at = ?, lease_owner = NULL,
             lease_expires_at = NULL, last_heartbeat_at = NULL,
             error_category = ?, error_summary = ?
           WHERE id = ? AND status = 'running' AND lease_owner = ? AND lease_expires_at > ?`,
        )
        .run(
          input.finishedAt,
          input.category,
          input.summary,
          input.taskId,
          input.workerId,
          input.finishedAt,
        ).changes === 1
    );
  }

  public markCancelled(taskId: TaskId, workerId: string, finishedAt: UtcInstant): boolean {
    return (
      this.#client
        .prepare(
          `UPDATE tasks SET status = 'cancelled', finished_at = ?, lease_owner = NULL,
             lease_expires_at = NULL, last_heartbeat_at = NULL,
             error_category = 'cancelled', error_summary = 'Task was cancelled.'
           WHERE id = ? AND status = 'running' AND lease_owner = ? AND lease_expires_at > ?`,
        )
        .run(finishedAt, taskId, workerId, finishedAt).changes === 1
    );
  }

  #cancelInside(taskId: TaskId, requestedAt: UtcInstant): CancelTaskResult {
    const task = this.get(taskId);
    if (!task) return { kind: 'not_found' };
    if (task.status === 'cancelled') return { kind: 'already_cancelled', task };
    if (task.status === 'pending') {
      this.#client
        .prepare(
          `UPDATE tasks SET status = 'cancelled', cancel_requested_at = ?, finished_at = ?,
             error_category = 'cancelled', error_summary = 'Task was cancelled before execution.'
           WHERE id = ? AND status = 'pending'`,
        )
        .run(requestedAt, requestedAt, taskId);
      const cancelled = this.get(taskId);
      if (!cancelled) throw new Error('Cancelled task disappeared.');
      return { kind: 'cancelled', task: cancelled };
    }
    if (task.status === 'running') {
      this.#client
        .prepare(
          `UPDATE tasks SET cancel_requested_at = ?
           WHERE id = ? AND status = 'running' AND cancel_requested_at IS NULL`,
        )
        .run(requestedAt, taskId);
      const requested = this.get(taskId);
      if (!requested) throw new Error('Cancellation-requested task disappeared.');
      return { kind: 'cancel_requested', task: requested };
    }
    return { kind: 'not_cancellable', task };
  }

  public cancel(taskId: TaskId, requestedAt: UtcInstant): CancelTaskResult {
    return this.#cancelTransaction(taskId, requestedAt);
  }

  public upsertSchedule(input: PersistedScheduleInput): ScheduleRecord {
    const row = this.#client
      .prepare(
        `INSERT INTO schedules
         (id, schedule_key, task_type, payload_json, cron_expression, timezone, enabled,
          next_run_at, last_enqueued_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
         ON CONFLICT(schedule_key) DO UPDATE SET
           task_type = excluded.task_type, payload_json = excluded.payload_json,
           cron_expression = excluded.cron_expression, timezone = excluded.timezone,
           enabled = excluded.enabled,
           next_run_at = CASE
             WHEN schedules.task_type != excluded.task_type
               OR schedules.payload_json != excluded.payload_json
               OR schedules.cron_expression != excluded.cron_expression
               OR schedules.timezone != excluded.timezone
             THEN excluded.next_run_at ELSE schedules.next_run_at END,
           updated_at = excluded.updated_at
         RETURNING ${SCHEDULE_COLUMNS}`,
      )
      .get(
        input.id,
        input.scheduleKey,
        input.taskType,
        canonicalJson(input.payload),
        input.cronExpression,
        input.timezone,
        input.enabled ? 1 : 0,
        input.nextRunAt,
        input.now,
        input.now,
      ) as ScheduleRow;
    return scheduleFromRow(row);
  }

  public dueSchedules(now: UtcInstant, limit: number): readonly ScheduleRecord[] {
    const rows = this.#client
      .prepare(
        `SELECT ${SCHEDULE_COLUMNS} FROM schedules
         WHERE enabled = 1 AND next_run_at <= ?
         ORDER BY next_run_at ASC, id ASC LIMIT ?`,
      )
      .all(now, limit) as ScheduleRow[];
    return rows.map(scheduleFromRow);
  }

  #commitScheduleOccurrenceInside(input: {
    readonly scheduleId: string;
    readonly expectedNextRunAt: UtcInstant;
    readonly occurrenceAt: UtcInstant;
    readonly nextRunAt: UtcInstant;
    readonly task: PersistedTaskInput;
    readonly now: UtcInstant;
  }): EnqueueTaskResult | null {
    const schedule = this.#client
      .prepare('SELECT next_run_at FROM schedules WHERE id = ? AND enabled = 1')
      .get(input.scheduleId) as { readonly next_run_at: number } | undefined;
    if (schedule?.next_run_at !== input.expectedNextRunAt) return null;

    let result: EnqueueTaskResult;
    try {
      result = { kind: 'enqueued', task: this.#insert(input.task) };
    } catch (error) {
      result = this.#resolveInsertConflict(input.task, error);
    }
    this.#client
      .prepare(
        `UPDATE schedules SET next_run_at = ?, last_enqueued_at = ?, updated_at = ?
         WHERE id = ? AND next_run_at = ?`,
      )
      .run(
        input.nextRunAt,
        input.occurrenceAt,
        input.now,
        input.scheduleId,
        input.expectedNextRunAt,
      );
    return result;
  }

  public commitScheduleOccurrence(input: {
    readonly scheduleId: string;
    readonly expectedNextRunAt: UtcInstant;
    readonly occurrenceAt: UtcInstant;
    readonly nextRunAt: UtcInstant;
    readonly task: PersistedTaskInput;
    readonly now: UtcInstant;
  }): EnqueueTaskResult | null {
    return this.#scheduleTransaction(input);
  }
}
