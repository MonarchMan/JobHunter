import { setTimeout as delay } from 'node:timers/promises';
import type { Clock, TaskId } from '@jobhunter/domain';
import type { HandlerRegistry } from './handler-registry.js';
import type { TaskCancellationNotifier, TaskLogger, TaskQueue, TaskRecord } from './model.js';
import { classifyTaskError, TaskExecutionError } from './retry-policy.js';
import type { RetryPolicy } from './retry-policy.js';
import type { ScheduleService } from './schedule-service.js';

export interface WorkerDelay {
  wait(milliseconds: number, signal: AbortSignal): Promise<void>;
}

export const nativeWorkerDelay: WorkerDelay = {
  async wait(milliseconds, signal): Promise<void> {
    await delay(milliseconds, undefined, { signal });
  },
};

export interface WorkerEngineOptions {
  readonly workerId: string;
  readonly heartbeatIntervalMs?: number;
  readonly emptyPollMinimumMs?: number;
  readonly emptyPollMaximumMs?: number;
  readonly schedulerPollMs?: number;
  readonly shutdownGraceMs?: number;
  readonly services?: Readonly<Record<string, unknown>>;
  readonly taskTypeConcurrency?: Readonly<Record<string, number>>;
}

const silentLogger: TaskLogger = {
  info(event, fields): void {
    void event;
    void fields;
  },
  warn(event, fields): void {
    void event;
    void fields;
  },
  error(event, fields): void {
    void event;
    void fields;
  },
};

type AbortReason = 'shutdown' | 'lease_lost' | 'cancelled';

export class WorkerEngine implements TaskCancellationNotifier {
  readonly #queue: TaskQueue;
  readonly #registry: HandlerRegistry;
  readonly #clock: Clock;
  readonly #retryPolicy: RetryPolicy;
  readonly #scheduleService: ScheduleService;
  readonly #logger: TaskLogger;
  readonly #delay: WorkerDelay;
  readonly #options: Required<WorkerEngineOptions>;
  readonly #controllers = new Map<TaskId, AbortController>();
  readonly #inFlight = new Set<Promise<void>>();
  #stopping = false;

  public constructor(input: {
    readonly queue: TaskQueue;
    readonly registry: HandlerRegistry;
    readonly clock: Clock;
    readonly retryPolicy: RetryPolicy;
    readonly scheduleService: ScheduleService;
    readonly logger?: TaskLogger;
    readonly workerDelay?: WorkerDelay;
    readonly options: WorkerEngineOptions;
  }) {
    this.#queue = input.queue;
    this.#registry = input.registry;
    this.#clock = input.clock;
    this.#retryPolicy = input.retryPolicy;
    this.#scheduleService = input.scheduleService;
    this.#logger = input.logger ?? silentLogger;
    this.#delay = input.workerDelay ?? nativeWorkerDelay;
    this.#options = {
      workerId: input.options.workerId,
      heartbeatIntervalMs: input.options.heartbeatIntervalMs ?? 30_000,
      emptyPollMinimumMs: input.options.emptyPollMinimumMs ?? 1_000,
      emptyPollMaximumMs: input.options.emptyPollMaximumMs ?? 10_000,
      schedulerPollMs: input.options.schedulerPollMs ?? 1_000,
      shutdownGraceMs: input.options.shutdownGraceMs ?? 10_000,
      services: input.options.services ?? {},
      taskTypeConcurrency: input.options.taskTypeConcurrency ?? {},
    };
    if (!this.#options.workerId.trim()) throw new TypeError('Worker ID must not be empty.');
    for (const [taskType, concurrency] of Object.entries(this.#options.taskTypeConcurrency)) {
      if (!taskType.trim()) throw new TypeError('Task type concurrency key must not be empty.');
      if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 32) {
        throw new TypeError(`Invalid task type concurrency for ${taskType}.`);
      }
    }
  }

  public async runOnce(taskType?: string): Promise<boolean> {
    if (this.#stopping) return false;
    const queues = taskType ? [taskType] : this.#registry.taskTypes();
    for (const queueType of queues) {
      const task = this.#queue.claim({
        taskType: queueType,
        workerId: this.#options.workerId,
        now: this.#clock.now(),
        leaseDurationMsFor: (claimedType) =>
          this.#registry.has(claimedType)
            ? this.#registry.get(claimedType).leaseDurationMs
            : 120_000,
      });
      if (!task) continue;
      const execution = this.#execute(task);
      this.#inFlight.add(execution);
      try {
        await execution;
      } finally {
        this.#inFlight.delete(execution);
      }
      return true;
    }
    return false;
  }

  async #execute(task: TaskRecord): Promise<void> {
    const handler = this.#registry.has(task.taskType) ? this.#registry.get(task.taskType) : null;
    const controller = new AbortController();
    this.#controllers.set(task.id, controller);
    let heartbeatStopped = false;
    const heartbeat = this.#heartbeat(task, controller, handler?.leaseDurationMs ?? 120_000, () => {
      return heartbeatStopped;
    });
    const startedAt = this.#clock.now();
    this.#logger.info('task.started', {
      taskId: task.id,
      taskType: task.taskType,
      attempt: task.attemptCount,
      leaseOwner: this.#options.workerId,
    });

    try {
      if (!handler) {
        throw new TaskExecutionError('invalid_config', 'No handler is registered for task type.');
      }
      const output = await this.#registry.execute(
        task.taskType,
        {
          taskId: task.id,
          signal: controller.signal,
          clock: this.#clock,
          logger: this.#logger,
          services: this.#options.services,
        },
        task.payload,
      );
      const lateCancellationPolicy =
        typeof handler.lateCancellationPolicy === 'function'
          ? handler.lateCancellationPolicy(output)
          : handler.lateCancellationPolicy;
      const completionWinsLateCancellation = lateCancellationPolicy === 'complete';
      if (controller.signal.reason === 'cancelled' && !completionWinsLateCancellation) {
        this.#queue.markCancelled(task.id, this.#options.workerId, this.#clock.now());
      } else if (
        !controller.signal.aborted ||
        (controller.signal.reason === 'cancelled' && completionWinsLateCancellation)
      ) {
        const completed = this.#queue.complete(
          task.id,
          this.#options.workerId,
          this.#clock.now(),
          output,
          { allowRequestedCancellation: completionWinsLateCancellation },
        );
        if (completed) {
          this.#logger.info('task.finished', {
            taskId: task.id,
            taskType: task.taskType,
            attempt: task.attemptCount,
            durationMs: this.#clock.now() - startedAt,
            result: 'succeeded',
          });
        } else {
          this.#finalizeRequestedCancellation(task);
        }
      }
    } catch (error) {
      this.#handleFailure(task, controller, error);
    } finally {
      heartbeatStopped = true;
      controller.abort('finished');
      await heartbeat;
      this.#controllers.delete(task.id);
    }
  }

  async #heartbeat(
    task: TaskRecord,
    controller: AbortController,
    leaseDurationMs: number,
    stopped: () => boolean,
  ): Promise<void> {
    while (!stopped() && !controller.signal.aborted) {
      try {
        await this.#delay.wait(this.#options.heartbeatIntervalMs, controller.signal);
      } catch {
        return;
      }
      if (stopped()) return;
      const result = this.#queue.heartbeat({
        taskId: task.id,
        workerId: this.#options.workerId,
        now: this.#clock.now(),
        leaseDurationMs,
      });
      if (!result.ownsLease) controller.abort('lease_lost' satisfies AbortReason);
      else if (result.cancelRequested) controller.abort('cancelled' satisfies AbortReason);
    }
  }

  #handleFailure(task: TaskRecord, controller: AbortController, error: unknown): void {
    const reason = controller.signal.reason as AbortReason | undefined;
    if (reason === 'shutdown' || reason === 'lease_lost') return;
    if (reason === 'cancelled') {
      this.#queue.markCancelled(task.id, this.#options.workerId, this.#clock.now());
      this.#logger.info('task.finished', {
        taskId: task.id,
        taskType: task.taskType,
        attempt: task.attemptCount,
        result: 'cancelled',
      });
      return;
    }

    if (this.#finalizeRequestedCancellation(task)) return;

    const classified = classifyTaskError(error);
    const decision = this.#retryPolicy.decide({
      category: classified.category,
      attemptCount: task.attemptCount,
      maxAttempts: task.maxAttempts,
      now: this.#clock.now(),
      retryAfterAt: classified.retryAfterAt,
    });
    if (decision.retry && decision.availableAt !== null) {
      this.#queue.reschedule({
        taskId: task.id,
        workerId: this.#options.workerId,
        availableAt: decision.availableAt,
        occurredAt: this.#clock.now(),
        category: classified.category,
        summary: classified.safeSummary,
      });
      this.#logger.warn('task.retry_scheduled', {
        taskId: task.id,
        taskType: task.taskType,
        attempt: task.attemptCount,
        errorCategory: classified.category,
        error: classified,
      });
      return;
    }

    const category = classified.category;
    this.#queue.fail({
      taskId: task.id,
      workerId: this.#options.workerId,
      finishedAt: this.#clock.now(),
      category,
      summary: classified.safeSummary,
    });
    this.#logger.error('task.failed', {
      taskId: task.id,
      taskType: task.taskType,
      attempt: task.attemptCount,
      errorCategory: category,
      error: classified,
    });
  }

  #finalizeRequestedCancellation(task: TaskRecord): boolean {
    const current = this.#queue.get(task.id);
    if (current?.status !== 'running' || current.cancelRequestedAt === null) return false;
    const cancelled = this.#queue.markCancelled(task.id, this.#options.workerId, this.#clock.now());
    if (cancelled) {
      this.#logger.info('task.finished', {
        taskId: task.id,
        taskType: task.taskType,
        attempt: task.attemptCount,
        result: 'cancelled',
      });
    }
    return true;
  }

  public async run(signal?: AbortSignal): Promise<void> {
    const shutdown = (): void => {
      void this.shutdown();
    };
    signal?.addEventListener('abort', shutdown, { once: true });
    if (signal?.aborted) await this.shutdown();
    try {
      await Promise.all([
        this.#runSchedulerLoop(),
        ...this.#registry
          .taskTypes()
          .flatMap((taskType) =>
            Array.from({ length: this.#options.taskTypeConcurrency[taskType] ?? 1 }, () =>
              this.#runClaimLoop(taskType),
            ),
          ),
      ]);
    } finally {
      signal?.removeEventListener('abort', shutdown);
    }
  }

  async #runClaimLoop(taskType: string): Promise<void> {
    let emptyDelay = this.#options.emptyPollMinimumMs;
    while (!this.#stopping) {
      const claimed = await this.runOnce(taskType);
      if (claimed) {
        emptyDelay = this.#options.emptyPollMinimumMs;
        continue;
      }
      try {
        await this.#delay.wait(emptyDelay, AbortSignal.timeout(emptyDelay + 100));
      } catch {
        // A timer cancellation is only a wake-up signal for the next state check.
      }
      emptyDelay = Math.min(this.#options.emptyPollMaximumMs, emptyDelay * 2);
    }
  }

  async #runSchedulerLoop(): Promise<void> {
    while (!this.#stopping) {
      this.#scheduleService.enqueueDue();
      try {
        await this.#delay.wait(
          this.#options.schedulerPollMs,
          AbortSignal.timeout(this.#options.schedulerPollMs + 100),
        );
      } catch {
        // A timer cancellation is only a wake-up signal for the next state check.
      }
    }
  }

  public async shutdown(): Promise<void> {
    if (this.#stopping) return;
    this.#stopping = true;
    for (const controller of this.#controllers.values()) {
      controller.abort('shutdown' satisfies AbortReason);
    }
    if (this.#inFlight.size === 0) return;
    await Promise.race([
      Promise.allSettled([...this.#inFlight]),
      delay(this.#options.shutdownGraceMs),
    ]);
  }

  public notifyCancellation(taskId: TaskId): void {
    this.#controllers.get(taskId)?.abort('cancelled' satisfies AbortReason);
  }
}
