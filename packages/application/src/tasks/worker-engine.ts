import { setTimeout as delay } from 'node:timers/promises';
import type { Clock, TaskId } from '@jobhunter/domain';
import type { HandlerRegistry } from './handler-registry.js';
import type { TaskCancellationNotifier, TaskLogger, TaskQueue, TaskRecord } from './model.js';
import { classifyTaskError, TaskExecutionError } from './retry-policy.js';
import type { RetryPolicy } from './retry-policy.js';
import type { ScheduleService } from './schedule-service.js';

/** 应用层数据结构或端口契约。 */
export interface WorkerDelay {
  wait(milliseconds: number, signal: AbortSignal): Promise<void>;
}

/** 基于 Node 定时器的默认延时实现。 */
export const nativeWorkerDelay: WorkerDelay = {
  async wait(milliseconds, signal): Promise<void> {
    await delay(milliseconds, undefined, { signal });
  },
};

/** 应用层数据结构或端口契约。 */
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

/** 应用层使用的类型约束。 */
type AbortReason = 'shutdown' | 'lease_lost' | 'cancelled';

/** 领取任务、维护租约、执行处理器、重试并优雅退出的 Worker 引擎。 */
export class WorkerEngine implements TaskCancellationNotifier {
  readonly #queue: TaskQueue;
  readonly #registry: HandlerRegistry;
  readonly #clock: Clock;
  readonly #retryPolicy: RetryPolicy;
  readonly #scheduleService: ScheduleService;
  readonly #logger: TaskLogger;
  readonly #delay: WorkerDelay;
  readonly #periodicWork: ((signal: AbortSignal) => Promise<void>) | undefined;
  readonly #isQueueBusy: (error: unknown) => boolean;
  readonly #lifecycle = new AbortController();
  #periodicLoop: Promise<void> | undefined;
  readonly #options: Required<WorkerEngineOptions>;
  readonly #controllers = new Map<TaskId, AbortController>();
  readonly #inFlight = new Set<Promise<void>>();
  #stopping = false;

  /** 执行应用组件对外暴露的操作。 */
  public constructor(input: {
    readonly queue: TaskQueue;
    readonly registry: HandlerRegistry;
    readonly clock: Clock;
    readonly retryPolicy: RetryPolicy;
    readonly scheduleService: ScheduleService;
    readonly logger?: TaskLogger;
    readonly workerDelay?: WorkerDelay;
    readonly periodicWork?: (signal: AbortSignal) => Promise<void>;
    readonly isQueueBusy?: (error: unknown) => boolean;
    readonly options: WorkerEngineOptions;
  }) {
    this.#queue = input.queue;
    this.#registry = input.registry;
    this.#clock = input.clock;
    this.#retryPolicy = input.retryPolicy;
    this.#scheduleService = input.scheduleService;
    this.#logger = input.logger ?? silentLogger;
    this.#delay = input.workerDelay ?? nativeWorkerDelay;
    this.#periodicWork = input.periodicWork;
    this.#isQueueBusy = input.isQueueBusy ?? (() => false);
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

  /** 尝试领取并执行一个任务；返回是否实际领取到任务。 */
  public async runOnce(taskType?: string): Promise<boolean> {
    if (this.#stopping) return false;
    const queues = taskType ? [taskType] : this.#registry.taskTypes();
    // 1、按任务类型领取一个租约；2. 执行完成后再返回给轮询器。
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

  /** 执行单个任务并协调心跳、取消、成功提交和失败重试。 */
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

    // 1、执行处理器并根据晚到取消策略决定结果优先级。
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
        handler.retryPayload?.(task.payload, task.result) ?? task.payload,
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
      // 2、失败路径统一交给分类、退避和最终失败处理。
      try {
        if (this.#isQueueBusy(error)) {
          // 2.a、数据库提交不可用时停止续租，由既有租约恢复处理，不能误报业务失败。
          controller.abort('lease_lost' satisfies AbortReason);
          this.#logger.warn('worker.queue_busy', { phase: 'completion', taskId: task.id });
        } else this.#handleFailure(task, controller, error);
      } catch (failureError) {
        if (!this.#isQueueBusy(failureError)) throw failureError;
        this.#logger.warn('worker.queue_busy', { phase: 'failure_commit', taskId: task.id });
      }
    } finally {
      heartbeatStopped = true;
      controller.abort('finished');
      await heartbeat;
      this.#controllers.delete(task.id);
    }
  }

  /** 定期续租，并在租约丢失或收到取消请求时中止处理器。 */
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
      try {
        const result = this.#queue.heartbeat({
          taskId: task.id,
          workerId: this.#options.workerId,
          now: this.#clock.now(),
          leaseDurationMs,
        });
        if (!result.ownsLease) controller.abort('lease_lost' satisfies AbortReason);
        else if (result.cancelRequested) controller.abort('cancelled' satisfies AbortReason);
      } catch (error) {
        if (!this.#isQueueBusy(error)) throw error;
        // 1、锁忙不代表已续租，下轮仍通过仓储检查实际租约所有权。
        this.#logger.warn('worker.queue_busy', { phase: 'heartbeat', taskId: task.id });
      }
    }
  }

  /** 按关闭、租约丢失、取消、可重试和永久失败顺序收敛任务状态。 */
  #handleFailure(task: TaskRecord, controller: AbortController, error: unknown): void {
    // 1、关闭或租约丢失时停止本地处理，不再写入不属于自己的结果。
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

    // 2、优先完成已请求取消的任务状态，再决定是否重试。
    if (this.#finalizeRequestedCancellation(task)) return;

    const classified = classifyTaskError(error);
    const decision = this.#retryPolicy.decide({
      category: classified.category,
      attemptCount: task.attemptCount,
      maxAttempts: task.maxAttempts,
      now: this.#clock.now(),
      retryAfterAt: classified.retryAfterAt,
      retryable: classified.retryable,
    });
    // 3、可重试错误进入退避队列，否则写入最终失败状态。
    if (decision.retry && decision.availableAt !== null) {
      this.#queue.reschedule({
        taskId: task.id,
        workerId: this.#options.workerId,
        availableAt: decision.availableAt,
        occurredAt: this.#clock.now(),
        category: classified.category,
        summary: classified.safeSummary,
        result: classified.result,
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
      result: classified.result,
    });
    this.#logger.error('task.failed', {
      taskId: task.id,
      taskType: task.taskType,
      attempt: task.attemptCount,
      errorCategory: category,
      error: classified,
    });
  }

  /** 将仍持有租约且已请求取消的任务安全标记为 cancelled。 */
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

  /** 启动调度循环和按任务类型拆分的领取循环，直到 Worker 停止。 */
  public async run(signal?: AbortSignal): Promise<void> {
    // 1、监听外部退出信号；2. 并行运行调度器和任务领取器。
    const shutdown = (): void => {
      void this.shutdown();
    };
    signal?.addEventListener('abort', shutdown, { once: true });
    if (signal?.aborted) await this.shutdown();
    this.#periodicLoop = this.#periodicWork ? this.#runPeriodicLoop() : undefined;
    const loops = [
      ...(this.#periodicLoop ? [this.#periodicLoop] : []),
      this.#runSchedulerLoop(),
      ...this.#registry
        .taskTypes()
        .flatMap((taskType) =>
          Array.from({ length: this.#options.taskTypeConcurrency[taskType] ?? 1 }, () =>
            this.#runClaimLoop(taskType),
          ),
        ),
    ];
    try {
      await Promise.all(loops);
    } finally {
      signal?.removeEventListener('abort', shutdown);
      // 3、异常退出也先取消各循环，等待子进程退出后才能关闭数据库连接。
      await this.shutdown();
      await Promise.allSettled(loops);
    }
  }

  /** 以指数退避轮询指定任务类型，领取成功后恢复最小空轮询间隔。 */
  async #runClaimLoop(taskType: string): Promise<void> {
    let emptyDelay = this.#options.emptyPollMinimumMs;
    while (!this.#stopping) {
      let claimed = false;
      try {
        claimed = await this.runOnce(taskType);
      } catch (error) {
        if (!this.#isQueueBusy(error)) throw error;
        this.#logger.warn('worker.queue_busy', { phase: 'claim', taskType });
      }
      if (claimed) {
        emptyDelay = this.#options.emptyPollMinimumMs;
        continue;
      }
      try {
        await this.#delay.wait(emptyDelay, this.#lifecycle.signal);
      } catch {
        // A timer cancellation is only a wake-up signal for the next state check.
      }
      emptyDelay = Math.min(this.#options.emptyPollMaximumMs, emptyDelay * 2);
    }
  }

  /** 独立驱动周期工作，维护子进程等待不阻塞普通调度。 */
  async #runPeriodicLoop(): Promise<void> {
    while (!this.#stopping) {
      // 1、周期维护自行判断持久化到期时间；异常只记录，不终止任务调度。
      try {
        await this.#periodicWork?.(this.#lifecycle.signal);
      } catch {
        if (!this.#lifecycle.signal.aborted)
          this.#logger.warn('worker.periodic_work_failed', { result: 'failed' });
      }
      try {
        await this.#delay.wait(this.#options.schedulerPollMs, this.#lifecycle.signal);
      } catch {
        return;
      }
    }
  }

  /** 周期扫描到期调度；锁冲突延后本轮，不改变调度游标。 */
  async #runSchedulerLoop(): Promise<void> {
    while (!this.#stopping) {
      try {
        this.#scheduleService.enqueueDue();
      } catch (error) {
        if (!this.#isQueueBusy(error)) throw error;
        this.#logger.warn('worker.queue_busy', { phase: 'schedule' });
      }
      try {
        await this.#delay.wait(this.#options.schedulerPollMs, this.#lifecycle.signal);
      } catch {
        // A timer cancellation is only a wake-up signal for the next state check.
      }
    }
  }

  /** 停止领取、取消活动任务，并在宽限期内等待在途执行结束。 */
  public async shutdown(): Promise<void> {
    if (this.#stopping) return;
    this.#stopping = true;
    this.#lifecycle.abort('shutdown');
    for (const controller of this.#controllers.values()) {
      controller.abort('shutdown' satisfies AbortReason);
    }
    if (this.#inFlight.size === 0 && !this.#periodicLoop) return;
    const grace = new AbortController();
    try {
      await Promise.race([
        Promise.allSettled([
          ...this.#inFlight,
          ...(this.#periodicLoop ? [this.#periodicLoop] : []),
        ]),
        delay(this.#options.shutdownGraceMs, undefined, { signal: grace.signal }),
      ]);
    } finally {
      // 1、提前收敛时清除宽限定时器，避免没有剩余工作却仍阻止进程退出。
      grace.abort();
    }
  }

  /** 接收应用层取消通知并中止对应任务的本地执行。 */
  public notifyCancellation(taskId: TaskId): void {
    this.#controllers.get(taskId)?.abort('cancelled' satisfies AbortReason);
  }
}
