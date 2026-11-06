import { randomUUID } from 'node:crypto';
import { createConnection } from 'node:net';
import { taskServiceAddress } from './host-bridge-address.js';
import {
  taskServiceMaximumMessageBytes,
  taskServiceProtocol,
  taskServiceResponseSchema,
  type TaskServiceRequest,
} from './host-bridge-protocol.js';

/** 服务不可用与协议不兼容必须区分；后者禁止启动替代调度者。 */
export class HostBridgeConnectionError extends Error {
  constructor(
    public readonly code: 'unavailable' | 'incompatible' | 'invalid_response' | 'operation_failed',
  ) {
    super(`Task service: ${code}`);
  }
}

/** 一次请求一条连接，连接断开不会改变宿主生命周期。 */
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
      ...(process.env.TASK_HOST_TOKEN ? { token: process.env.TASK_HOST_TOKEN } : {}),
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
      finish(new HostBridgeConnectionError('unavailable'));
    });
    socket.once('connect', () => socket.write(request));
    socket.once('error', () => {
      finish(new HostBridgeConnectionError('unavailable'));
    });
    socket.once('end', () => {
      finish(new HostBridgeConnectionError('invalid_response'));
    });
    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.byteLength > taskServiceMaximumMessageBytes) {
        finish(new HostBridgeConnectionError('invalid_response'));
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
            new HostBridgeConnectionError(
              response.code === 'incompatible' ? 'incompatible' : 'operation_failed',
            ),
          );
        else finish(undefined, response.value);
      } catch {
        finish(new HostBridgeConnectionError('invalid_response'));
      }
    });
  });
}
