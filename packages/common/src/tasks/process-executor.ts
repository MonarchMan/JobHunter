import type { ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import type { TaskHandlerContext, TaskRecord } from './model.js';
import type { TaskExecutionPort } from './worker-engine.js';
import { AsyncSemaphore } from './async-semaphore.js';
import { TaskExecutionError, classifyTaskError } from './retry-policy.js';

const parentMessage = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('execute'),
    id: z.uuid(),
    task: z
      .object({
        id: z.uuid(),
        taskType: z.string().min(1),
        leaseOwner: z.string().min(1),
        status: z.literal('running'),
        attemptCount: z.number().int().positive(),
        payload: z.unknown(),
        result: z.unknown().optional(),
      })
      .loose(),
  }),
  z.object({ kind: z.literal('abort'), id: z.uuid() }),
  z.object({ kind: z.literal('permit'), id: z.uuid() }),
]);
const childMessage = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('alive') }),
  z.object({ kind: z.literal('acquire'), id: z.uuid() }),
  z.object({ kind: z.literal('release'), id: z.uuid() }),
  z.object({ kind: z.literal('result'), id: z.uuid(), value: z.unknown().optional() }),
  z.object({
    kind: z.literal('error'),
    id: z.uuid(),
    category: z.enum([
      'rate_limited',
      'network_temporary',
      'io_temporary',
      'upstream_5xx',
      'parse_changed',
      'invalid_config',
      'validation_failed',
      'cancelled',
      'permanent',
    ]),
    summary: z.string().max(240),
    retryable: z.boolean().nullable(),
    retryAfterAt: z.number().nullable(),
    result: z.unknown().optional(),
  }),
]);

/** 每个逻辑组固定执行进程，保留招聘平台的内存会话；全局网络许可由父进程统一发放。 */
export class ProcessTaskExecutor implements TaskExecutionPort {
  readonly #children = new Map<string, ChildProcess>();
  readonly #pending = new Map<
    string,
    {
      child: ChildProcess;
      resolve(value: unknown): void;
      reject(error: unknown): void;
      cleanup(): void;
    }
  >();
  readonly #permits = new Map<
    string,
    { child: ChildProcess; abort: AbortController; release?: () => void }
  >();
  readonly #heartbeats = new Map<ChildProcess, number>();
  readonly #monitor: ReturnType<typeof setInterval>;
  #closed = false;

  constructor(
    private readonly spawn: (group: string) => ChildProcess,
    private readonly network: AsyncSemaphore,
  ) {
    this.#monitor = setInterval(() => {
      // 1、父进程心跳不能代替子进程存活报告；事件循环卡住后必须停止续持执行。
      for (const [child, lastSeen] of this.#heartbeats)
        if (Date.now() - lastSeen > 45_000) child.kill('SIGKILL');
    }, 10_000);
    this.#monitor.unref();
  }

  /** 仅分派中央引擎已经领取的任务；子进程不具有队列扫描入口。 */
  execute(task: TaskRecord, context: TaskHandlerContext): Promise<unknown> {
    if (this.#closed) return Promise.reject(new Error('Executor closed'));
    const prefix = task.taskType.split('.')[0] ?? 'default';
    const group = ['source', 'platform', 'mail'].includes(prefix) ? 'recruitment' : prefix;
    let child = this.#children.get(group);
    if (!child) {
      child = this.spawn(group);
      this.#children.set(group, child);
      this.#heartbeats.set(child, Date.now());
      const selected = child;
      child.on('message', (message: unknown) => {
        this.#onMessage(selected, message);
      });
      child.once('error', () => {
        this.#disconnect(group, selected);
      });
      child.once('exit', () => {
        this.#disconnect(group, selected);
      });
      child.once('disconnect', () => {
        this.#disconnect(group, selected);
      });
    }
    const executor = child;
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      let cancellationTimeout: ReturnType<typeof setTimeout> | undefined;
      const cleanup = (): void => {
        context.signal.removeEventListener('abort', cancel);
        if (cancellationTimeout) clearTimeout(cancellationTimeout);
      };
      const cancel = (): void => {
        if (executor.connected) executor.send({ kind: 'abort', id }, () => undefined);
        // 已提交结果可能正在返回，先等待执行端确认，保留完成先于取消的事务语义。
        cancellationTimeout = setTimeout(() => {
          this.#pending.delete(id);
          cleanup();
          reject(new TaskExecutionError('cancelled', 'Task execution cancelled.'));
        }, 5_000);
      };
      this.#pending.set(id, { child: executor, resolve, reject, cleanup });
      context.signal.addEventListener('abort', cancel, { once: true });
      if (context.signal.aborted) {
        this.#pending.delete(id);
        cleanup();
        reject(new TaskExecutionError('cancelled', 'Task execution cancelled.'));
        return;
      }
      executor.send({ kind: 'execute', id, task }, (error) => {
        if (error) this.#disconnect(group, executor);
      });
    });
  }

  /** 校验子进程响应和许可请求，不接受其他进程的关联 ID。 */
  #onMessage(child: ChildProcess, message: unknown): void {
    const parsed = childMessage.safeParse(message);
    if (!parsed.success) {
      child.kill();
      return;
    }
    const data = parsed.data;
    this.#heartbeats.set(child, Date.now());
    if (data.kind === 'alive') return;
    if (data.kind === 'acquire') {
      if (this.#permits.has(data.id)) {
        child.kill();
        return;
      }
      const permit: { child: ChildProcess; abort: AbortController; release?: () => void } = {
        child,
        abort: new AbortController(),
      };
      this.#permits.set(data.id, permit);
      void this.network
        .run(
          permit.abort.signal,
          () =>
            new Promise<void>((resolve) => {
              permit.release = resolve;
              if (child.connected)
                child.send({ kind: 'permit', id: data.id }, (error) => {
                  if (error) resolve();
                });
              else resolve();
            }),
        )
        .catch(() => undefined)
        .finally(() => this.#permits.delete(data.id));
      return;
    }
    if (data.kind === 'release') {
      const permit = this.#permits.get(data.id);
      if (permit?.child === child) {
        permit.abort.abort();
        permit.release?.();
      }
      return;
    }
    const request = this.#pending.get(data.id);
    if (request?.child !== child) return;
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

  /** 失联时归还网络许可并拒绝在途请求，恢复决策留给中央引擎。 */
  #disconnect(group: string, child: ChildProcess): void {
    if (this.#children.get(group) === child) this.#children.delete(group);
    this.#heartbeats.delete(child);
    if (child.connected) child.disconnect();
    for (const [id, request] of this.#pending)
      if (request.child === child) {
        this.#pending.delete(id);
        request.cleanup();
        request.reject(new TaskExecutionError('network_temporary', 'Task executor disconnected.'));
      }
    for (const permit of this.#permits.values())
      if (permit.child === child) {
        permit.abort.abort();
        permit.release?.();
      }
  }

  /** 服务关闭等待执行进程退出，不能遗留旧业务写入者。 */
  async close(): Promise<void> {
    this.#closed = true;
    clearInterval(this.#monitor);
    await Promise.all(
      [...this.#children].map(
        ([group, child]) =>
          new Promise<void>((resolve) => {
            if (child.exitCode !== null || child.signalCode !== null) {
              resolve();
              return;
            }
            child.once('exit', () => {
              clearTimeout(timeout);
              resolve();
            });
            const timeout = setTimeout(() => child.kill('SIGKILL'), 5_000);
            this.#disconnect(group, child);
            if (child.connected) child.disconnect();
          }),
      ),
    );
  }
}

/** 子进程通过父调度者申请网络许可，不按进程数放大全局并发预算。 */
export class ProcessNetworkSemaphore extends AsyncSemaphore {
  readonly #waiting = new Map<string, () => void>();
  readonly #receive = (message: unknown): void => {
    const parsed = parentMessage.safeParse(message);
    if (parsed.success && parsed.data.kind === 'permit') this.#waiting.get(parsed.data.id)?.();
  };
  constructor() {
    super(1);
    process.on('message', this.#receive);
  }
  override async run<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
    signal.throwIfAborted();
    const id = randomUUID();
    let cancel: () => void = () => undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        cancel = () => {
          reject(new TaskExecutionError('cancelled', 'Network permit cancelled.'));
        };
        this.#waiting.set(id, resolve);
        signal.addEventListener('abort', cancel, { once: true });
        if (!process.connected) {
          reject(new Error('Scheduler disconnected'));
          return;
        }
        process.send?.({ kind: 'acquire', id }, (error) => {
          if (error) reject(error);
        });
      });
      signal.throwIfAborted();
      return await operation();
    } finally {
      signal.removeEventListener('abort', cancel);
      this.#waiting.delete(id);
      if (process.connected) process.send?.({ kind: 'release', id }, () => undefined);
    }
  }
  close(): void {
    process.off('message', this.#receive);
  }
}

/** 执行宿主只处理父进程分派；父连接断开后停止所有工作并释放资源。 */
export async function serveTaskExecutor(application: {
  executeAssigned?(task: TaskRecord, signal: AbortSignal): Promise<unknown>;
  close(): Promise<void>;
}): Promise<void> {
  if (!process.send || !application.executeAssigned)
    throw new Error('Internal executor requires IPC');
  const controllers = new Map<string, AbortController>();
  const active = new Set<Promise<void>>();
  const heartbeat = setInterval(() => {
    if (process.connected) process.send?.({ kind: 'alive' }, () => undefined);
  }, 5_000);
  const receive = (message: unknown): void => {
    const parsed = parentMessage.safeParse(message);
    if (!parsed.success) {
      process.disconnect();
      return;
    }
    const data = parsed.data;
    if (data.kind === 'permit') return;
    if (data.kind === 'abort') {
      controllers.get(data.id)?.abort();
      return;
    }
    if (controllers.has(data.id)) {
      process.disconnect();
      return;
    }
    const executeAssigned = application.executeAssigned?.bind(application);
    if (!executeAssigned) return;
    const controller = new AbortController();
    controllers.set(data.id, controller);
    const work = (async () => {
      try {
        const value = await executeAssigned(data.task as unknown as TaskRecord, controller.signal);
        if (process.connected)
          process.send?.({ kind: 'result', id: data.id, value }, () => undefined);
      } catch (error) {
        const classified = classifyTaskError(error);
        if (process.connected)
          process.send?.(
            {
              kind: 'error',
              id: data.id,
              category: classified.category,
              summary: classified.safeSummary,
              retryable: classified.retryable,
              retryAfterAt: classified.retryAfterAt,
              result: classified.result,
            },
            () => undefined,
          );
      } finally {
        controllers.delete(data.id);
      }
    })();
    active.add(work);
    void work.finally(() => active.delete(work));
  };
  process.on('message', receive);
  try {
    await new Promise<void>((resolve) => {
      if (!process.connected) resolve();
      else process.once('disconnect', resolve);
    });
  } finally {
    clearInterval(heartbeat);
    process.off('message', receive);
    for (const controller of controllers.values()) controller.abort();
    // 1、先让协作取消的处理器收敛，再关闭数据库；无响应处理器由父进程最终回收。
    const grace = new AbortController();
    try {
      await Promise.race([
        Promise.allSettled([...active]),
        delay(4_000, undefined, { signal: grace.signal }),
      ]);
    } finally {
      grace.abort();
    }
    await application.close();
  }
}
