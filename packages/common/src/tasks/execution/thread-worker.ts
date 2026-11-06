import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import { parentPort, type MessagePort } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import { AsyncSemaphore } from '../concurrency/async-semaphore.js';
import { TaskExecutionError, classifyTaskError } from '../scheduling/retry-policy.js';
import { toThreadSchema, checkThreadMessageSize } from './thread-protocol.js';
import { threadStorageFailure } from './thread-storage-error.js';
import type { TaskApplication } from '../host/runtime.js';
import type { TaskRecord } from '../contracts/model.js';

/** 线程内外部请求必须向主线程申请许可；终止线程会由主线程回收许可。 */
export class ThreadNetworkSemaphore extends AsyncSemaphore {
  readonly #port: MessagePort;
  readonly #waiting = new Map<string, { resolve(): void; reject(error: Error): void }>();
  readonly #receive = (message: unknown): void => {
    const parsed = toThreadSchema.safeParse(message);
    if (parsed.success && parsed.data.kind === 'permit')
      this.#waiting.get(parsed.data.id)?.resolve();
  };
  constructor() {
    super(1);
    if (!parentPort) throw new Error('Task worker requires parent port');
    this.#port = parentPort;
    parentPort.on('message', this.#receive);
  }
  override async beforeSourceRequest(
    sourceKey: string,
    policy: { requestsPerMinute: number; burst: number },
    signal: AbortSignal,
  ): Promise<boolean> {
    await this.#request(signal, () => Promise.resolve(), { key: sourceKey, ...policy });
    return true;
  }
  override async run<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
    return this.#request(signal, operation);
  }
  async #request<T>(
    signal: AbortSignal,
    operation: () => Promise<T>,
    source?: { key: string; requestsPerMinute: number; burst: number },
  ): Promise<T> {
    signal.throwIfAborted();
    const id = randomUUID();
    const cancel = (): void =>
      this.#waiting
        .get(id)
        ?.reject(new TaskExecutionError('cancelled', 'Network permit cancelled.'));
    try {
      await new Promise<void>((resolve, reject) => {
        this.#waiting.set(id, { resolve, reject });
        signal.addEventListener('abort', cancel, { once: true });
        this.#port.postMessage({ kind: 'acquire', id, ...(source ? { source } : {}) });
        if (signal.aborted) cancel();
      });
      signal.throwIfAborted();
      return await operation();
    } finally {
      signal.removeEventListener('abort', cancel);
      this.#waiting.delete(id);
      this.#port.postMessage({ kind: 'release', id });
    }
  }
  /** 运行时先关闭任务，再解除监听，不能留下等待中的许可。 */
  close(): void {
    parentPort?.off('message', this.#receive);
    for (const waiter of this.#waiting.values()) waiter.reject(new Error('Task worker closed'));
    this.#waiting.clear();
  }
}

/** 业务线程只执行已分派任务，不领取、调度、迁移或恢复其他任务。 */
export async function serveTaskThread(
  application: Pick<TaskApplication, 'executeAssigned' | 'close'>,
): Promise<void> {
  const port = parentPort;
  const executeAssigned = application.executeAssigned?.bind(application);
  if (!port || !executeAssigned) throw new Error('Task worker requires execution application');
  const controllers = new Map<string, AbortController>();
  const active = new Set<Promise<void>>();
  let stopping = false;
  let finish!: () => void;
  const stopped = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const receive = (message: unknown): void => {
    const parsed = toThreadSchema.safeParse(message);
    if (!parsed.success) {
      stopping = true;
      finish();
      return;
    }
    const data = parsed.data;
    if (data.kind === 'shutdown') {
      stopping = true;
      finish();
      return;
    }
    if (data.kind === 'permit') return;
    if (data.kind === 'abort') {
      controllers.get(data.id)?.abort();
      return;
    }
    if (stopping || controllers.has(data.id)) {
      stopping = true;
      finish();
      return;
    }
    const controller = new AbortController();
    controllers.set(data.id, controller);
    const work = (async () => {
      try {
        const value = await executeAssigned(data.task as unknown as TaskRecord, controller.signal);
        const result = { kind: 'result', id: data.id, value };
        checkThreadMessageSize(result);
        port.postMessage(result);
      } catch (error) {
        const classified = classifyTaskError(error);
        const response = {
          kind: 'error',
          id: data.id,
          category: classified.category,
          summary: classified.safeSummary,
          storageFailure: threadStorageFailure(error),
          retryable: classified.retryable,
          retryAfterAt: classified.retryAfterAt,
          result: classified.result,
        };
        try {
          checkThreadMessageSize(response);
          port.postMessage(response);
        } catch {
          port.postMessage({
            ...response,
            summary: 'Task response exceeded message limit.',
            result: undefined,
          });
        }
      } finally {
        controllers.delete(data.id);
      }
    })();
    active.add(work);
    void work.finally(() => active.delete(work));
  };
  const loopDelay = monitorEventLoopDelay({ resolution: 20 });
  loopDelay.enable();
  let previous = performance.eventLoopUtilization();
  const heartbeat = setInterval(() => {
    const current = performance.eventLoopUtilization();
    const delta = performance.eventLoopUtilization(current, previous);
    previous = current;
    port.postMessage({
      kind: 'alive',
      utilization: delta.utilization,
      eventLoopDelayMs: loopDelay.percentile(95) / 1_000_000,
    });
    loopDelay.reset();
  }, 5_000);
  port.on('message', receive);
  port.once('close', finish);
  port.postMessage({ kind: 'ready' });
  try {
    await stopped;
  } finally {
    stopping = true;
    for (const controller of controllers.values()) controller.abort();
    await Promise.allSettled([...active]);
    try {
      await application.close();
    } finally {
      clearInterval(heartbeat);
      loopDelay.disable();
      port.off('message', receive);
      port.postMessage({ kind: 'closed' });
      port.close();
    }
  }
}
