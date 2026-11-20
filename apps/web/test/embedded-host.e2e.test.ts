import { expect, it } from 'vitest';
import { loadRuntimeAppConfig } from '@jobhunter/common/config/index';
import { requestTaskService, taskHostConfiguration } from '@jobhunter/common/task-host-runtime';
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

const shutdownModes = process.platform === 'win32' ? ['shutdown'] : ['shutdown', 'group-kill'];

it.each(shutdownModes)(
  'owns its task threads and stops the entire runtime on %s',
  async (mode) => {
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
        // 强杀测试单独创建进程组，避免信号发送给测试进程。
        detached: mode === 'group-kill',
        env: {
          ...process.env,
          DATA_ROOT: root.path,
          TASK_THREAD_POOL: '{"startupTimeoutMs":90000}',
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
      configuration: taskHostConfiguration(serviceConfig),
    };
    if (!child.stdout || !child.stderr) throw new Error('Expected captured child output');
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
    const address = `http://127.0.0.1:${String(port)}/`;
    try {
      // 2、走真实入口和 Next 页面编译，不能由直接创建测试容器替代。
      const deadline = Date.now() + 150_000;
      let ready = false;
      while (Date.now() < deadline) {
        if (child.exitCode !== null) throw new Error(`Web exited: ${output}`);
        try {
          const response = await fetch(address);
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
      // 3、命令桥仅服务本宿主 Next，其他入口不能附着或停止宿主。
      await expect(requestTaskService({ ...serviceInput, method: 'ping' })).rejects.toMatchObject({
        code: 'incompatible',
      });
      // 4、验证显式关闭与测试工具强杀启动器进程组两条路径。
      if (mode === 'group-kill') {
        if (!child.pid) throw new Error('Missing Web process group');
        process.kill(-child.pid, 'SIGKILL');
      } else {
        child.send('shutdown');
      }
      await expect
        .poll(
          async () => {
            try {
              const response = await fetch(address, { signal: AbortSignal.timeout(500) });
              await response.body?.cancel();
              return true;
            } catch (error) {
              // 请求超时不能证明监听端口已经关闭。
              if (!(error instanceof TypeError)) throw error;
              return false;
            }
          },
          { timeout: 15_000 },
        )
        .toBe(false);
      expect(await closed, output).toBe(mode === 'group-kill' ? null : 0);
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
    } finally {
      if (child.exitCode === null && !child.killed) child.kill('SIGTERM');
      // 强杀用例若回归，遗留的 Next 可能仍持有输出管道，避免阻塞测试清理。
      if (mode !== 'group-kill') await closed;
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
  },
  180_000,
);
