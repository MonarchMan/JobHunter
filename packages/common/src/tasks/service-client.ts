import { randomUUID } from 'node:crypto';
import { createConnection } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { taskServiceAddress } from './service-address.js';
import { acquireTaskServiceLock } from '../persistence/task-service-lock.js';
import {
  taskServiceMaximumMessageBytes,
  taskServiceProtocol,
  taskServiceResponseSchema,
  type TaskServiceRequest,
} from './service-protocol.js';

/** 服务不可用与协议不兼容必须区分；后者禁止启动替代调度者。 */
export class TaskServiceConnectionError extends Error {
  constructor(
    public readonly code: 'unavailable' | 'incompatible' | 'invalid_response' | 'operation_failed',
  ) {
    super(`Task service: ${code}`);
  }
}

/** 显式停止独立服务；锁释放证明执行器和数据库已回收，不以 socket 消失代替。 */
export async function stopTaskService(input: {
  readonly dataRoot: string;
  readonly configuration: string;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}): Promise<void> {
  const address = await taskServiceAddress(input.dataRoot);
  const deadline = Date.now() + (input.timeoutMs ?? 30_000);
  while (Date.now() < deadline) {
    input.signal?.throwIfAborted();
    // 1、包括服务尚未监听的冷启动窗口：持锁即视为仍有实例，继续请求停止。
    const release = acquireTaskServiceLock(address.dataRoot);
    if (release) {
      release();
      return;
    }
    try {
      await requestTaskService({ ...input, method: 'shutdown', timeoutMs: 500 });
    } catch (error) {
      if (!(error instanceof TaskServiceConnectionError) || error.code !== 'unavailable')
        throw error;
    }
    await delay(100, undefined, input.signal ? { signal: input.signal } : {});
  }
  throw new TaskServiceConnectionError('unavailable');
}

/** 一次请求一条连接，客户端退出不会向共享服务发送关闭命令。 */
export async function requestTaskService(input: {
  readonly dataRoot: string;
  readonly configuration: string;
  readonly method: TaskServiceRequest['method'];
  readonly value?: unknown;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}): Promise<unknown> {
  const { endpoint } = await taskServiceAddress(input.dataRoot);
  input.signal?.throwIfAborted();
  const id = randomUUID();
  const request =
    JSON.stringify({
      id,
      protocol: taskServiceProtocol,
      configuration: input.configuration,
      method: input.method,
      input: input.value,
    }) + '\n';
  if (Buffer.byteLength(request) > taskServiceMaximumMessageBytes)
    throw new RangeError('Task service request too large');
  return new Promise((resolve, reject) => {
    const socket = createConnection(endpoint);
    let buffer = Buffer.alloc(0);
    let settled = false;
    const finish = (error?: unknown, value?: unknown): void => {
      if (settled) return;
      settled = true;
      input.signal?.removeEventListener('abort', cancel);
      socket.destroy();
      if (error)
        reject(error instanceof Error ? error : new Error('Task service request cancelled'));
      else resolve(value);
    };
    const cancel = (): void => {
      finish(input.signal?.reason ?? new Error('Task service wait aborted'));
    };
    input.signal?.addEventListener('abort', cancel, { once: true });
    socket.setTimeout(input.timeoutMs ?? 5_000, () => {
      finish(new TaskServiceConnectionError('unavailable'));
    });
    socket.once('connect', () => socket.write(request));
    socket.once('error', () => {
      finish(new TaskServiceConnectionError('unavailable'));
    });
    socket.once('end', () => {
      finish(new TaskServiceConnectionError('invalid_response'));
    });
    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.byteLength > taskServiceMaximumMessageBytes) {
        finish(new TaskServiceConnectionError('invalid_response'));
        return;
      }
      const newline = buffer.indexOf(10);
      if (newline < 0) return;
      try {
        const response = taskServiceResponseSchema.parse(
          JSON.parse(buffer.subarray(0, newline).toString('utf8')),
        );
        if (response.id !== id) throw new Error('Response mismatch');
        if (!response.ok)
          finish(
            new TaskServiceConnectionError(
              response.code === 'incompatible' ? 'incompatible' : 'operation_failed',
            ),
          );
        else finish(undefined, response.value);
      } catch {
        finish(new TaskServiceConnectionError('invalid_response'));
      }
    });
  });
}

/** 探测后按需请求组合根拉起服务；并发启动的候选进程由服务锁决定唯一所有者。 */
export async function ensureTaskService(input: {
  readonly dataRoot: string;
  readonly configuration: string;
  readonly start: () => void | Promise<void>;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}): Promise<void> {
  const ping = (): Promise<unknown> =>
    requestTaskService({ ...input, method: 'ping', timeoutMs: 500 });
  try {
    await ping();
    return;
  } catch (error) {
    if (!(error instanceof TaskServiceConnectionError) || error.code !== 'unavailable') throw error;
  }
  await input.start();
  const deadline = Date.now() + (input.timeoutMs ?? 15_000);
  while (Date.now() < deadline) {
    try {
      await ping();
      return;
    } catch (error) {
      if (!(error instanceof TaskServiceConnectionError) || error.code !== 'unavailable')
        throw error;
    }
    await delay(100, undefined, input.signal ? { signal: input.signal } : {});
  }
  throw new TaskServiceConnectionError('unavailable');
}
