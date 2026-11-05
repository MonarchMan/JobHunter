import { expect, it } from 'vitest';
import { loadRuntimeAppConfig } from '@jobhunter/common/config/index';
import {
  requestTaskService,
  stopTaskService,
  taskServiceConfiguration,
} from '@jobhunter/common/task-service';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { createTemporaryDataRoot } from '@jobhunter/common/testing';
import { openSqliteDatabase } from '@jobhunter/common/persistence/connection';
import { SqliteTaskRepository } from '@jobhunter/common/persistence/tasks';
import { parseId, utcInstant } from '@jobhunter/common/domain';

/** 分配本机临时端口，避免碰触开发者已运行的 Web 服务。 */
async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    }),
  );
  if (!address || typeof address === 'string') throw new Error('Missing temporary port');
  return address.port;
}

it('shares a central service that survives Web shutdown and is explicitly stopped by test cleanup', async () => {
  const root = await createTemporaryDataRoot('jobhunter-web-host-');
  const port = await availablePort();
  const database = openSqliteDatabase({ dataRoot: root.path });
  const queue = new SqliteTaskRepository(database.client);
  const taskId = parseId('018f0000-0000-7000-8000-00000000e201', 'Task');
  // 1、只使用失效的合成研究上下文，能证明自动消费而不访问任何外部服务。
  queue.enqueue({
    id: taskId,
    taskType: 'interview.experience-research.execute',
    payload: {
      requestId: '018f0000-0000-7000-8000-00000000e202',
      requestFingerprint: 'a'.repeat(64),
      expectedRevision: 0,
      executorKey: 'configured-model',
    },
    priority: 0,
    idempotencyKey: 'host-lifecycle',
    concurrencyKey: null,
    retryOfTaskId: null,
    maxAttempts: 1,
    availableAt: utcInstant(1),
    createdAt: utcInstant(1),
  });
  const child = spawn(
    process.execPath,
    ['--conditions=development', '--import', 'tsx', 'src/server/main.ts'],
    {
      cwd: path.resolve(import.meta.dirname, '..'),
      // IPC 通道用于跨平台请求优雅关闭：Windows 的 child.kill 直接终止进程，子进程收不到信号。
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: {
        ...process.env,
        DATA_ROOT: root.path,
        API_KEY: '',
        MODEL: '',
        BASE_URL: 'https://api.openai.com/v1',
        PORT: String(port),
        HOST: '127.0.0.1',
        NODE_ENV: 'development',
        NEXT_DIST_DIR: `.next-host-test-${randomUUID()}`,
      },
    },
  );
  const serviceConfig = await loadRuntimeAppConfig({
    workspaceRoot: path.resolve(import.meta.dirname, '../../..'),
    environment: {
      ...process.env,
      DATA_ROOT: root.path,
      API_KEY: '',
      MODEL: '',
      BASE_URL: 'https://api.openai.com/v1',
    },
  });
  const serviceInput = {
    dataRoot: root.path,
    configuration: taskServiceConfiguration(serviceConfig),
  };
  let output = '';
  child.stdout.on('data', (data: Buffer) => {
    output += data.toString();
  });
  child.stderr.on('data', (data: Buffer) => {
    output += data.toString();
  });
  const closed = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => {
      resolve(code);
    });
  });
  try {
    // 2、走真实入口和 Next 页面编译，不能由直接创建测试容器替代。
    const deadline = Date.now() + 60_000;
    let ready = false;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`Web exited: ${output}`);
      try {
        const response = await fetch(`http://127.0.0.1:${String(port)}/`);
        expect(response.status, output).toBe(200);
        expect(await response.text()).toContain('<h1');
        ready = true;
        break;
      } catch (error) {
        if (!(error instanceof TypeError)) throw error;
        await delay(100);
      }
    }
    expect(ready, output).toBe(true);
    expect(queue.get(taskId)).toMatchObject({ status: 'failed', errorCategory: 'cancelled' });
    // 服务崩溃不影响 Web 存活；下一次写操作应重新连接并恢复统一执行能力。
    const original = (await requestTaskService({ ...serviceInput, method: 'ping' })) as {
      pid: number;
    };
    process.kill(original.pid, 'SIGKILL');
    await expect
      .poll(async () => {
        try {
          await requestTaskService({ ...serviceInput, method: 'ping', timeoutMs: 100 });
          return false;
        } catch {
          return true;
        }
      })
      .toBe(true);
    const origin = `http://127.0.0.1:${String(port)}`;
    const csrfResponse = await fetch(`${origin}/api/csrf`);
    const csrf = (await csrfResponse.json()) as { data: { token: string } };
    const recovered = await fetch(`${origin}/api/tasks/${taskId}/cancel`, {
      method: 'POST',
      headers: {
        origin,
        'content-type': 'application/json',
        'x-jobhunter-csrf': csrf.data.token,
        cookie: `jobhunter_csrf=${csrf.data.token}`,
      },
      body: JSON.stringify({ idempotencyToken: 'host-crash-recovery' }),
    });
    expect(recovered.status, await recovered.text()).toBe(200);
    const replacement = (await requestTaskService({ ...serviceInput, method: 'ping' })) as {
      pid: number;
    };
    expect(replacement.pid).not.toBe(original.pid);
    // 3、关闭页面入口后中央服务仍须存活；测试清理时再显式关闭自己的服务。
    // 经 IPC 通知而非信号：Windows 上 child.kill 直接终止进程，子进程无法执行清理。
    child.send('shutdown');
    expect(await closed, output).toBe(0);
    await expect(requestTaskService({ ...serviceInput, method: 'ping' })).resolves.toBeDefined();
  } finally {
    if (child.exitCode === null && !child.killed) child.kill('SIGTERM');
    await closed;
    await stopTaskService(serviceInput);
    // 等待共享服务释放自己的资源后再删除临时数据目录。
    await expect
      .poll(async () => {
        try {
          await requestTaskService({ ...serviceInput, method: 'ping', timeoutMs: 100 });
          return false;
        } catch {
          return true;
        }
      })
      .toBe(true);
    database.close();
    await root.cleanup();
  }
}, 90_000);
