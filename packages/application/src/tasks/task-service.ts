import { parseId, type TaskId, type UtcInstant } from '@jobhunter/domain';
import type { HandlerRegistry } from './handler-registry.js';
import type {
  CancelTaskResult,
  EnqueueTaskResult,
  PersistedTaskInput,
  TaskListFilter,
  TaskCancellationNotifier,
  TaskQueue,
  TaskQueueSummary,
  TaskRecord,
  TaskRuntimeDependencies,
} from './model.js';

export interface EnqueueTaskCommand {
  readonly taskType: string;
  readonly payload: unknown;
  readonly idempotencyKey: string;
  readonly priority?: number;
  readonly concurrencyKey?: string | null;
  readonly maxAttempts?: number;
  readonly availableAt?: UtcInstant;
}

function validateCount(value: number, field: string, minimum: number): void {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new TypeError(`${field} is invalid.`);
  }
}

export class TaskService {
  readonly #queue: TaskQueue;
  readonly #registry: HandlerRegistry;
  readonly #dependencies: TaskRuntimeDependencies;
  readonly #cancellationNotifier: TaskCancellationNotifier | null;

  public constructor(
    dependencies: TaskRuntimeDependencies,
    registry: HandlerRegistry,
    cancellationNotifier: TaskCancellationNotifier | null = null,
  ) {
    this.#queue = dependencies.queue;
    this.#registry = registry;
    this.#dependencies = dependencies;
    this.#cancellationNotifier = cancellationNotifier;
  }

  public enqueue(command: EnqueueTaskCommand): EnqueueTaskResult {
    const handler = this.#registry.get(command.taskType);
    const payload = handler.payloadSchema.parse(command.payload);
    const idempotencyKey = command.idempotencyKey.trim();
    if (!idempotencyKey) throw new TypeError('Task idempotency key must not be empty.');
    const priority = command.priority ?? 0;
    const maxAttempts = command.maxAttempts ?? handler.defaultMaxAttempts;
    validateCount(priority, 'Task priority', -1_000_000);
    validateCount(maxAttempts, 'Task max attempts', 1);
    const derivedConcurrencyKey = handler.concurrencyKey?.(payload) ?? null;
    const concurrencyKey = command.concurrencyKey ?? derivedConcurrencyKey;
    if (concurrencyKey !== null && !concurrencyKey.trim()) {
      throw new TypeError('Task concurrency key must not be empty.');
    }
    const now = this.#dependencies.clock.now();
    const input: PersistedTaskInput = {
      id: parseId(this.#dependencies.ids.generate(), 'Task'),
      taskType: command.taskType,
      payload,
      priority,
      idempotencyKey,
      concurrencyKey,
      scheduleId: null,
      retryOfTaskId: null,
      maxAttempts,
      availableAt: command.availableAt ?? now,
      createdAt: now,
    };
    return this.#queue.enqueue(input);
  }

  public get(taskId: TaskId): TaskRecord | null {
    return this.#queue.get(taskId);
  }

  public list(filter: TaskListFilter = {}): readonly TaskRecord[] {
    return this.#queue.list(filter);
  }

  public count(filter: Omit<TaskListFilter, 'limit' | 'offset'> = {}): number {
    return this.#queue.count(filter);
  }

  public summary(): TaskQueueSummary {
    return this.#queue.summary(this.#dependencies.clock.now());
  }

  public cancel(taskId: TaskId): CancelTaskResult {
    const result = this.#queue.cancel(taskId, this.#dependencies.clock.now());
    if (result.kind === 'cancel_requested') {
      this.#cancellationNotifier?.notifyCancellation(taskId);
    }
    return result;
  }

  public retryFailed(taskId: TaskId, retryToken: string): EnqueueTaskResult {
    const source = this.#queue.get(taskId);
    if (!source) throw new TypeError('Task was not found.');
    if (source.status !== 'failed') throw new TypeError('Only failed tasks can be retried.');
    const token = retryToken.trim();
    if (!token) throw new TypeError('Retry token must not be empty.');
    const handler = this.#registry.get(source.taskType);
    const payload = handler.payloadSchema.parse(source.payload);
    const now = this.#dependencies.clock.now();
    return this.#queue.enqueue({
      id: parseId(this.#dependencies.ids.generate(), 'Task'),
      taskType: source.taskType,
      payload,
      priority: source.priority,
      idempotencyKey: `${source.idempotencyKey}:manual-retry:${token}`,
      concurrencyKey: source.concurrencyKey,
      scheduleId: null,
      retryOfTaskId: source.id,
      maxAttempts: handler.defaultMaxAttempts,
      availableAt: now,
      createdAt: now,
    });
  }
}
