import { createServer, type Socket } from 'node:net';
import { chmod, rm, mkdir } from 'node:fs/promises';
import {
  acquireTaskServiceLock,
  withTaskServiceOwnership,
} from '../persistence/task-service-lock.js';
import { taskServiceAddress } from './service-address.js';
import {
  taskServiceMaximumMessageBytes,
  taskServiceRequestSchema,
  type TaskServiceRequest,
} from './service-protocol.js';

/** 组合根注入实际队列和生命周期；common 不导入招聘、画像或匹配业务。 */
export interface CentralTaskRuntime {
  run(signal: AbortSignal): Promise<void>;
  request(
    method: Exclude<TaskServiceRequest['method'], 'ping' | 'shutdown'>,
    input: unknown,
  ): unknown;
  close(): Promise<void>;
}

/** 启动同数据目录唯一服务；竞争失败返回 null，绝不装配第二套运行时。 */
export async function startCentralTaskService(input: {
  readonly dataRoot: string;
  readonly configuration: string;
  readonly createRuntime: () => CentralTaskRuntime | Promise<CentralTaskRuntime>;
}): Promise<{ readonly finished: Promise<void>; close(): Promise<void> } | null> {
  const address = await taskServiceAddress(input.dataRoot);
  const release = acquireTaskServiceLock(address.dataRoot);
  if (!release) return null;
  const releaseLock = release;
  const sockets = new Set<Socket>();
  const abort = new AbortController();
  let runtime: CentralTaskRuntime | undefined;
  let closing: Promise<void> | undefined;
  let running: Promise<void> = Promise.resolve();
  // 1、仅持有排他锁的进程可以清理崩溃遗留的 socket。
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.setTimeout(5_000, () => socket.destroy());
    socket.on('error', () => socket.destroy());
    socket.once('close', () => sockets.delete(socket));
    let buffer = Buffer.alloc(0);
    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.byteLength > taskServiceMaximumMessageBytes) {
        socket.destroy();
        return;
      }
      const newline = buffer.indexOf(10);
      if (newline < 0) return;
      socket.removeAllListeners('data');
      // 2、每条连接只处理一个有界请求；业务错误不向客户端泄露原始异常。
      void (async () => {
        let request: TaskServiceRequest;
        try {
          request = taskServiceRequestSchema.parse(
            JSON.parse(buffer.subarray(0, newline).toString('utf8')),
          );
        } catch {
          socket.destroy();
          return;
        }
        // 本机用户显式停止旧配置实例是维护操作；其他操作仍严格匹配配置。
        if (request.configuration !== input.configuration && request.method !== 'shutdown') {
          socket.end(JSON.stringify({ id: request.id, ok: false, code: 'incompatible' }) + '\n');
          return;
        }
        try {
          const value =
            request.method === 'ping'
              ? { pid: process.pid }
              : request.method === 'shutdown'
                ? null
                : await requireRuntime().request(request.method, request.input);
          const response = JSON.stringify({ id: request.id, ok: true, value }) + '\n';
          if (Buffer.byteLength(response) > taskServiceMaximumMessageBytes)
            throw new Error('Response too large');
          socket.end(response);
          if (request.method === 'shutdown') void close().catch(() => undefined);
        } catch {
          socket.end(
            JSON.stringify({ id: request.id, ok: false, code: 'operation_failed' }) + '\n',
          );
        }
      })();
    });
  });
  /** 接收请求前必须完成运行时装配。 */
  function requireRuntime(): CentralTaskRuntime {
    if (!runtime) throw new Error('Task service is not ready');
    return runtime;
  }
  /** 服务停止时先撤销执行并回收运行时，最后释放单实例所有权。 */
  function close(): Promise<void> {
    return (closing ??= (async () => {
      abort.abort();
      const stopped = server.listening
        ? new Promise<void>((resolve) =>
            server.close(() => {
              resolve();
            }),
          )
        : Promise.resolve();
      for (const socket of sockets) socket.end();
      try {
        await running;
      } finally {
        try {
          await runtime?.close();
        } finally {
          for (const socket of sockets) socket.destroy();
          await stopped;
          if (process.platform !== 'win32') await rm(address.endpoint, { force: true });
          releaseLock();
        }
      }
    })());
  }
  try {
    await mkdir(address.dataRoot, { recursive: true });
    if (process.platform !== 'win32') await rm(address.endpoint, { force: true });
    runtime = await withTaskServiceOwnership(address.dataRoot, input.createRuntime);
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(address.endpoint, () => {
        server.off('error', reject);
        resolve();
      });
    });
    if (process.platform !== 'win32') await chmod(address.endpoint, 0o600);
    running = Promise.resolve().then(() => requireRuntime().run(abort.signal));
    const finished = running.then(close, async (error: unknown) => {
      // 3、关闭仍清理所有资源，错误交给进程组合根决定退出码。
      await close().catch(() => undefined);
      throw error;
    });
    return { finished, close };
  } catch (error) {
    await close().catch(() => undefined);
    throw error;
  }
}
