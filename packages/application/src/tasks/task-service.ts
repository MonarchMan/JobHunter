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
  TaskRetryCoordinator,
  TaskRuntimeDependencies,
} from './model.js';

/** 应用层数据结构或端口契约。 */
export interface EnqueueTaskCommand {
  readonly taskType: string;
  readonly payload: unknown;
  readonly idempotencyKey: string;
  readonly priority?: number;
  readonly concurrencyKey?: string | null;
  readonly maxAttempts?: number;
  readonly availableAt?: UtcInstant;
}

/** 校验任务优先级、重试次数等安全整数参数。 */
function validateCount(value: number, field: string, minimum: number): void {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new TypeError(`${field} is invalid.`);
  }
}

/** 任务入队、查询、取消和手动重试的应用服务。 */
export class TaskService {
  readonly #queue: TaskQueue;
  readonly #registry: HandlerRegistry;
  readonly #dependencies: TaskRuntimeDependencies;
  readonly #cancellationNotifier: TaskCancellationNotifier | null;
  readonly #retryCoordinator: TaskRetryCoordinator | null;

  /** 执行应用组件对外暴露的操作。 */
  public constructor(
    dependencies: TaskRuntimeDependencies,
    registry: HandlerRegistry,
    cancellationNotifier: TaskCancellationNotifier | null = null,
    retryCoordinator: TaskRetryCoordinator | null = null,
  ) {
    this.#queue = dependencies.queue;
    this.#registry = registry;
    this.#dependencies = dependencies;
    this.#cancellationNotifier = cancellationNotifier;
    this.#retryCoordinator = retryCoordinator;
  }

  /** 执行应用组件对外暴露的操作。 */
  public enqueue(command: EnqueueTaskCommand): EnqueueTaskResult {
    // 1、通过处理器 Schema 校验 payload，并计算幂等键、并发键和默认参数。
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
    // 2、在队列端口内执行幂等和并发约束。
    return this.#queue.enqueue(input);
  }

  /** 查询单个任务。 */
  public get(taskId: TaskId): TaskRecord | null {
    return this.#queue.get(taskId);
  }

  /** 按条件分页查询任务。 */
  public list(filter: TaskListFilter = {}): readonly TaskRecord[] {
    return this.#queue.list(filter);
  }

  /** 统计符合条件的任务数量。 */
  public count(filter: Omit<TaskListFilter, 'limit' | 'offset'> = {}): number {
    return this.#queue.count(filter);
  }

  /** 返回当前队列摘要。 */
  public summary(): TaskQueueSummary {
    return this.#queue.summary(this.#dependencies.clock.now());
  }

  /** 请求取消任务，并通知正在运行的 Worker。 */
  public cancel(taskId: TaskId): CancelTaskResult {
    const result = this.#queue.cancel(taskId, this.#dependencies.clock.now());
    if (result.kind === 'cancel_requested') {
      this.#cancellationNotifier?.notifyCancellation(taskId);
    }
    return result;
  }

  /** 为失败任务创建带手动重试令牌的新任务。 */
  public retryFailed(taskId: TaskId, retryToken: string): EnqueueTaskResult {
    const source = this.#queue.get(taskId);
    if (!source) throw new TypeError('Task was not found.');
    if (source.status !== 'failed') throw new TypeError('Only failed tasks can be retried.');
    const token = retryToken.trim();
    if (!token) throw new TypeError('Retry token must not be empty.');
    const handler = this.#registry.get(source.taskType);
    const payload = handler.payloadSchema.parse(source.payload);
    const now = this.#dependencies.clock.now();
    const retry: PersistedTaskInput = {
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
    };
    return this.#retryCoordinator?.enqueueRetry({ source, retry }) ?? this.#queue.enqueue(retry);
  }
}
