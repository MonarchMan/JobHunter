import { expect, it } from 'vitest';
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

it('starts the actual Web host, consumes tasks without a worker entry and shuts down cleanly', async () => {
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
    scheduleId: null,
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
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
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
    // 3、只向测试创建的宿主发信号，等待 Next、维护进程和任务资源一起关闭。
    child.kill('SIGTERM');
    expect(await closed, output).toBe(0);
  } finally {
    if (child.exitCode === null && !child.killed) child.kill('SIGTERM');
    await closed;
    database.close();
    await root.cleanup();
  }
}, 90_000);
