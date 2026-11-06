import { TokenBucketSourceRateLimitGate } from '../concurrency/source-token-bucket.js';
import type { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import type { AsyncSemaphore } from '../concurrency/async-semaphore.js';
import { TaskExecutionError } from '../scheduling/retry-policy.js';
import { fromThreadSchema, checkThreadMessageSize } from './thread-protocol.js';
import type { TaskHandlerContext, TaskRecord } from '../contracts/model.js';
import type { TaskExecutionPort, TaskExecutionReservation } from '../scheduling/worker-engine.js';

import { threadPoolOptionsSchema, type ThreadPoolOptions } from './thread-pool-options.js';
export { threadPoolOptionsSchema, type ThreadPoolOptions } from './thread-pool-options.js';

/** 线程代次由独立 Worker 对象表达；槽位含预留，未就绪线程不提供容量。 */
interface ThreadSlot {
  worker: Worker;
  ready: boolean;
  stopping: boolean;
  active: number;
  lastActive: number;
  heartbeat: number;
  utilization: number;
  affinities: Set<string>;
  initialized: Promise<void>;
  resolveReady(): void;
  rejectReady(error: Error): void;
  startup: ReturnType<typeof setTimeout>;
  exited: Promise<void>;
}

/** 主线程拥有的动态执行池；线程只接受已领取任务，网络额度全局共享。 */
export class ThreadTaskExecutor implements TaskExecutionPort {
  readonly options: ThreadPoolOptions;
  readonly #sourceRates = new Map<
    string,
    { policy: string; gate: TokenBucketSourceRateLimitGate }
  >();
  readonly #slots = new Set<ThreadSlot>();
  readonly #affinities = new Map<string, ThreadSlot>();
  readonly #pending = new Map<
    string,
    {
      slot: ThreadSlot;
      resolve(value: unknown): void;
      reject(error: unknown): void;
      cleanup(): void;
    }
  >();
  readonly #permits = new Map<
    string,
    { slot: ThreadSlot; abort: AbortController; release?: () => void }
  >();
  readonly #monitor: ReturnType<typeof setInterval>;
  #closed = false;
  #closing: Promise<void> | undefined;
  #lastSpawn = -Infinity;
  #nextSpawn = 0;
  #failures = 0;
  #fatal: Error | undefined;
  #lastMonitor = Date.now();

  constructor(
    private readonly createWorker: () => Worker,
    private readonly network: AsyncSemaphore,
    options: Partial<ThreadPoolOptions> = {},
  ) {
    this.options = Object.freeze(threadPoolOptionsSchema.parse(options));
    this.#monitor = setInterval(
      () => {
        this.#tick();
      },
      Math.min(1_000, this.options.idleTimeoutMs),
    );
    this.#monitor.unref();
  }

  /** 启动最小健康容量，握手失败直接暴露给宿主，不把失败线程视为可用。 */
  async initialize(): Promise<void> {
    if (this.#closed) throw new Error('Task pool is closed');
    while (this.#slots.size < this.options.minThreads) this.#create();
    await Promise.all([...this.#slots].map((slot) => slot.initialized));
  }

  /** 领取前原子预留，池满返回空值，由调度者稍后公平重试。 */
  reserve(_taskType: string, affinity?: string): TaskExecutionReservation | undefined {
    if (this.#fatal) throw this.#fatal;
    if (this.#closed || this.activeCount >= this.options.maxActiveTasks) return undefined;
    let slot = affinity ? this.#affinities.get(affinity) : undefined;
    if (slot && (!slot.ready || slot.stopping || slot.active >= this.options.maxTasksPerThread))
      return undefined;
    slot ??= [...this.#slots]
      .filter(
        (item) =>
          item.ready &&
          !item.stopping &&
          item.active < this.options.maxTasksPerThread &&
          (item.utilization < 0.9 || item.active === 0),
      )
      .sort((a, b) => a.active - b.active || a.affinities.size - b.affinities.size)[0];
    if (!slot) {
      // 1、外部请求已饱和时增加线程无法增加吞吐；只在本地容量不足时扩容。
      if (
        !this.network.saturated &&
        ![...this.#sourceRates.values()].some((rate) => rate.gate.queuedCount() > 0)
      )
        this.#scaleUp();
      return undefined;
    }
    const selected = slot;
    selected.active++;
    let released = false;
    let used = false;
    return {
      execute: (task, context) => {
        if (released || used) return Promise.reject(new Error('Invalid task reservation'));
        if (context.signal.aborted)
          return Promise.reject(
            new TaskExecutionError('cancelled', 'Task cancelled before dispatch.'),
          );
        if (selected.stopping)
          return Promise.reject(
            new TaskExecutionError('network_temporary', 'Reserved task worker is stopping.'),
          );
        used = true;
        if (affinity) {
          this.#affinities.set(affinity, selected);
          selected.affinities.add(affinity);
        }
        return this.#execute(selected, task, context);
      },
      release: () => {
        if (released) return;
        released = true;
        selected.active--;
        if (used) selected.lastActive = Date.now();
      },
    };
  }

  /** 直接调用仅供适配器契约使用；生产引擎必须在领取前 reserve。 */
  execute(task: TaskRecord, context: TaskHandlerContext): Promise<unknown> {
    const reservation = this.reserve(task.taskType);
    if (!reservation) return Promise.reject(new Error('Task pool has no reserved capacity'));
    return reservation.execute(task, context).finally(() => {
      reservation.release();
    });
  }

  /** 业务模块确认会话结束后释放固定关系，不检查业务 payload。 */
  releaseAffinity(key: string): void {
    const slot = this.#affinities.get(key);
    this.#affinities.delete(key);
    slot?.affinities.delete(key);
  }

  /** 数据库锁忙时延缓扩容，避免增加写争用。 */
  deferExpansion(milliseconds: number): void {
    this.#nextSpawn = Math.max(this.#nextSpawn, Date.now() + milliseconds);
  }
  /** 只返回容量和资源数量，不返回会话键或业务输入。 */
  metrics(): Readonly<Record<string, unknown>> {
    return {
      threadCount: this.threadCount,
      taskActive: this.activeCount,
      threadStarting: [...this.#slots].filter((slot) => !slot.ready).length,
      sessionPins: this.#affinities.size,
      workerFailures: this.#failures,
    };
  }

  get activeCount(): number {
    return [...this.#slots].reduce((sum, slot) => sum + slot.active, 0);
  }
  get threadCount(): number {
    return this.#slots.size;
  }

  /** 新线程完成业务装配后才进入 ready，超时和异常均等待线程退出。 */
  #create(): ThreadSlot {
    const worker = this.createWorker();
    let resolveReady!: () => void;
    let rejectReady!: (error: Error) => void;
    const initialized = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    void initialized.catch(() => undefined);
    let resolveExit!: () => void;
    const exited = new Promise<void>((resolve) => {
      resolveExit = resolve;
    });
    const slot: ThreadSlot = {
      worker,
      ready: false,
      stopping: false,
      active: 0,
      lastActive: Date.now(),
      heartbeat: Date.now(),
      utilization: 0,
      affinities: new Set(),
      initialized,
      resolveReady,
      rejectReady,
      exited,
      startup: setTimeout(() => {
        void this.#terminate(slot, new Error('Task worker startup timed out'));
      }, this.options.startupTimeoutMs),
    };
    this.#slots.add(slot);
    this.#lastSpawn = Date.now();
    worker.on('message', (message: unknown) => {
      this.#receive(slot, message);
    });
    worker.once('error', () => {
      void this.#terminate(slot, new Error('Task worker failed'));
    });
    worker.once('exit', () => {
      resolveExit();
      this.#remove(slot);
      const error = new TaskExecutionError('network_temporary', 'Task worker exited.');
      rejectReady(error);
      for (const [id, request] of this.#pending)
        if (request.slot === slot) {
          this.#pending.delete(id);
          request.cleanup();
          request.reject(error);
        }
    });
    return slot;
  }

  /** 扩容逐个进行；启动失败退避且有次数上限，不产生重建风暴。 */
  #scaleUp(): void {
    if (
      this.#closed ||
      this.#slots.size >= this.options.maxThreads ||
      Date.now() < this.#nextSpawn ||
      Date.now() - this.#lastSpawn < this.options.scaleUpCooldownMs
    )
      return;
    try {
      void this.#create().initialized.catch(() => {
        this.#failures++;
        this.#nextSpawn = Date.now() + Math.min(30_000, 1_000 * 2 ** this.#failures);
        if (this.#failures >= 5 && ![...this.#slots].some((slot) => slot.ready))
          this.#fatal = new Error('Task worker pool could not recover');
      });
    } catch {
      this.#nextSpawn = Date.now() + 5_000;
      this.#failures++;
      if (this.#failures >= 5) this.#fatal = new Error('Task worker pool could not start');
    }
  }

  /** 主线程自身暂停时延长观察窗口，避免同时误判所有工作线程。 */
  #tick(): void {
    const now = Date.now();
    const stalled = now - this.#lastMonitor > this.options.heartbeatTimeoutMs / 2;
    this.#lastMonitor = now;
    for (const slot of this.#slots) {
      if (stalled) slot.heartbeat = now;
      if (slot.stopping) continue;
      if (slot.ready && now - slot.heartbeat > this.options.heartbeatTimeoutMs) {
        void this.#terminate(slot, new Error('Task worker heartbeat timed out'));
        continue;
      }
      if (
        slot.ready &&
        !slot.active &&
        !slot.affinities.size &&
        now - slot.lastActive > this.options.idleTimeoutMs &&
        [...this.#slots].filter((item) => !item.stopping).length > this.options.minThreads
      ) {
        slot.stopping = true;
        slot.worker.postMessage({ kind: 'shutdown' });
        const timer = setTimeout(() => {
          void this.#terminate(slot, new Error('Task worker drain timed out'));
        }, this.options.shutdownGraceMs);
        void slot.exited.then(() => {
          clearTimeout(timer);
        });
      }
    }
    if (!this.#closed && this.#slots.size < this.options.minThreads) this.#scaleUp();
  }

  #execute(slot: ThreadSlot, task: TaskRecord, context: TaskHandlerContext): Promise<unknown> {
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const cancel = (): void => {
        slot.worker.postMessage({ kind: 'abort', id });
        timer ??= setTimeout(() => {
          void this.#terminate(
            slot,
            new TaskExecutionError('cancelled', 'Task worker cancellation timed out.'),
          );
        }, this.options.shutdownGraceMs);
      };
      const cleanup = (): void => {
        context.signal.removeEventListener('abort', cancel);
        if (timer) clearTimeout(timer);
      };
      this.#pending.set(id, { slot, resolve, reject, cleanup });
      context.signal.addEventListener('abort', cancel, { once: true });
      try {
        context.signal.throwIfAborted();
        const message = { kind: 'execute', id, task };
        checkThreadMessageSize(message);
        slot.worker.postMessage(message);
      } catch (error) {
        this.#pending.delete(id);
        cleanup();
        reject(
          new TaskExecutionError(
            error instanceof RangeError ? 'validation_failed' : 'network_temporary',
            error instanceof RangeError
              ? 'Task input exceeded message limit.'
              : 'Task dispatch could not reach its worker.',
          ),
        );
      }
    });
  }

  /** 响应和许可必须来自原始 Worker，异常消息终止对应线程。 */
  #receive(slot: ThreadSlot, message: unknown): void {
    try {
      checkThreadMessageSize(message);
    } catch {
      void this.#terminate(slot, new Error('Invalid task worker message'));
      return;
    }
    const parsed = fromThreadSchema.safeParse(message);
    if (!parsed.success) {
      void this.#terminate(slot, new Error('Invalid task worker response'));
      return;
    }
    const data = parsed.data;
    slot.heartbeat = Date.now();
    if (data.kind === 'ready') {
      if (slot.stopping || slot.ready) return;
      clearTimeout(slot.startup);
      slot.ready = true;
      this.#failures = 0;
      slot.resolveReady();
      return;
    }
    if (data.kind === 'alive') {
      slot.utilization = data.utilization ?? 0;
      return;
    }
    if (data.kind === 'closed') return;
    if (data.kind === 'acquire') {
      if (slot.stopping || this.#permits.has(data.id)) {
        void this.#terminate(slot, new Error('Invalid network permit'));
        return;
      }
      const permit: { slot: ThreadSlot; abort: AbortController; release?: () => void } = {
        slot,
        abort: new AbortController(),
      };
      this.#permits.set(data.id, permit);
      const grant = (): Promise<void> =>
        new Promise<void>((resolve) => {
          permit.release = resolve;
          slot.worker.postMessage({ kind: 'permit', id: data.id });
        });
      let operation: Promise<void>;
      if (data.source) {
        const policy = JSON.stringify({
          requestsPerMinute: data.source.requestsPerMinute,
          burst: data.source.burst,
        });
        let rate = this.#sourceRates.get(data.source.key);
        if (rate && rate.policy !== policy) {
          void this.#terminate(slot, new Error('Conflicting source rate policy'));
          return;
        }
        if (!rate) {
          rate = {
            policy,
            gate: new TokenBucketSourceRateLimitGate(new Map([[data.source.key, data.source]])),
          };
          this.#sourceRates.set(data.source.key, rate);
        }
        operation = rate.gate
          .beforeRequest({ sourceKey: data.source.key, signal: permit.abort.signal })
          .then(() => {
            permit.abort.signal.throwIfAborted();
            return grant();
          });
      } else operation = this.network.run(permit.abort.signal, grant);
      void operation.catch(() => undefined).finally(() => this.#permits.delete(data.id));
      return;
    }
    if (data.kind === 'release') {
      const permit = this.#permits.get(data.id);
      if (permit?.slot === slot) {
        permit.abort.abort();
        permit.release?.();
      }
      return;
    }
    const request = this.#pending.get(data.id);
    if (request?.slot !== slot) return;
    this.#pending.delete(data.id);
    request.cleanup();
    if (data.kind === 'result') request.resolve(data.value);
    else
      request.reject(
        new TaskExecutionError(data.category, data.summary, {
          ...(data.retryable === null ? {} : { retryable: data.retryable }),
          ...(data.retryAfterAt === null
            ? {}
            : { retryAfterAt: data.retryAfterAt as TaskRecord['availableAt'] }),
          result: data.result,
        }),
      );
  }

  #remove(slot: ThreadSlot): void {
    clearTimeout(slot.startup);
    this.#slots.delete(slot);
    for (const key of slot.affinities)
      if (this.#affinities.get(key) === slot) this.#affinities.delete(key);
    for (const permit of this.#permits.values())
      if (permit.slot === slot) {
        permit.abort.abort();
        permit.release?.();
      }
  }

  /** 等待真实退出后才拒绝任务，避免旧写入者仍存活时重新执行。 */
  async #terminate(slot: ThreadSlot, error: Error): Promise<void> {
    slot.stopping = true;
    slot.rejectReady(error);
    await slot.worker.terminate();
    await slot.exited;
  }

  /** 关闭幂等，先协作回收，再终止超时线程；返回时不留业务写入者。 */
  close(): Promise<void> {
    return (this.#closing ??= (async () => {
      this.#closed = true;
      clearInterval(this.#monitor);
      const settled = await Promise.allSettled(
        [...this.#slots].map(async (slot) => {
          slot.stopping = true;
          const timer = setTimeout(() => {
            void this.#terminate(slot, new Error('Task pool shutdown'));
          }, this.options.shutdownGraceMs);
          try {
            try {
              slot.worker.postMessage({ kind: 'shutdown' });
            } catch {
              await slot.worker.terminate();
            }
          } finally {
            // 3、即使发送或终止失败，也不能在实际退出之前关闭数据库或释放所有权。
            try {
              await slot.exited;
            } finally {
              clearTimeout(timer);
            }
          }
        }),
      );
      const failures = settled.filter((result) => result.status === 'rejected');
      if (failures.length)
        throw new AggregateError(
          failures.map((result) => result.reason as unknown),
          'Task worker cleanup failed',
        );
    })());
  }
}
