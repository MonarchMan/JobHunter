import { utcInstant } from '@jobhunter/common/domain';
import { isSqliteUnavailableError } from '../src/persistence/busy-error.js';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createSafeLogger,
  createThreadLogChannel,
  createThreadLogger,
} from '../src/logging/index.js';
import { ThreadTaskExecutor } from '../src/tasks/execution/thread-executor.js';
import { AsyncSemaphore } from '../src/tasks/concurrency/async-semaphore.js';
import type { TaskRecord, TaskHandlerContext } from '../src/tasks/contracts/model.js';

/** 合成任务保留真实消息身份；不接触本机运行数据。 */
function task(fail = false): TaskRecord {
  return {
    id: randomUUID(),
    taskType: 'fixture',
    status: 'running',
    leaseOwner: randomUUID(),
    attemptCount: 2,
    payload: { fail },
  } as TaskRecord;
}
describe('single writer across task threads', () => {
  it.each([false, true, 'tool'])(
    'drains concurrent worker events and preserves remote failure evidence (storage=%s)',
    async (storage) => {
      const root = await mkdtemp(join(tmpdir(), 'jobhunter-thread-log-'));
      const logger = createSafeLogger({
        logFile: join(root, 'app.log'),
        maxFileBytes: 2048,
        maxFiles: 50,
        stderr: {
          write() {
            /* 测试不向终端输出。 */
          },
        },
      });
      const pool = new ThreadTaskExecutor(
        () => {
          const channel = createThreadLogChannel(logger);
          const worker = new Worker(
            "require('tsx/esm/api').tsImport(require('node:worker_threads').workerData.entry, require('node:url').pathToFileURL(process.cwd() + '/').href)",
            {
              eval: true,
              workerData: {
                entry: new URL('./fixtures/logging/thread.ts', import.meta.url).href,
                logPort: channel.port,
              },
              transferList: [channel.port],
            },
          );
          worker.once('exit', () => {
            channel.close();
          });
          return worker;
        },
        new AsyncSemaphore(2),
        { minThreads: 2, maxThreads: 2 },
      );
      try {
        await pool.initialize();
        const first = task(),
          second = { ...task(true), payload: { fail: true, storage } };
        const context: TaskHandlerContext = {
          signal: new AbortController().signal,
          logger,
          services: {},
          clock: { now: () => utcInstant(Date.now()) },
        };
        const results = await Promise.allSettled([
          pool.execute(first, context),
          pool.execute(second, context),
        ]);
        expect(results[0].status).toBe('fulfilled');
        expect(results[1].status).toBe('rejected');
        if (results[1].status === 'rejected') {
          if (storage === 'tool') {
            expect(results[1].reason).toMatchObject({ category: 'permanent', retryable: false });
            expect(isSqliteUnavailableError(results[1].reason)).toBe(false);
          }
          logger.error('fixture.failed', { taskId: second.id, error: results[1].reason });
        }
        await pool.close();
        await logger.close();
        const text = (
          await Promise.all((await readdir(root)).map((file) => readFile(join(root, file), 'utf8')))
        ).join('');
        const records = text
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line) as Record<string, unknown>);
        expect(
          records.filter((row) => row.event === 'fixture.thread' && row.taskId === first.id),
        ).toHaveLength(12);
        expect(
          records.filter((row) => row.event === 'fixture.thread' && row.taskId === second.id),
        ).toHaveLength(12);
        expect(text).toContain(
          storage === 'tool' ? 'SQLITE_BUSY' : storage ? 'SQLITE_ERROR' : 'ECONNRESET',
        );
        expect(text).toContain('fixtures/logging/thread.ts');
        expect(text).toContain('root cause');
        expect(text).not.toContain('token=private');
        expect((await readdir(root)).length).toBeGreaterThan(1);
      } finally {
        await pool.close();
        await logger.close();
        await rm(root, { recursive: true, force: true });
      }
    },
  );
  it('bounds in-flight events and reports dropped events after credits recover', async () => {
    const records: Record<string, unknown>[] = [];
    const root = createSafeLogger({
      stderr: { write: (line) => records.push(JSON.parse(line) as Record<string, unknown>) },
    });
    const channel = createThreadLogChannel(root);
    const logger = createThreadLogger(channel.port, 'info');
    for (let index = 0; index < 300; index++) logger.info('burst', { index });
    await logger.close();
    channel.close();
    await root.close();
    expect(records.filter((row) => row.event === 'burst')).toHaveLength(128);
    expect(records.find((row) => row.event === 'logging.thread_events_dropped')?.dropped).toBe(172);
  });
});

it('records module bootstrap failures before a task runtime can be created', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jobhunter-startup-log-'));
  try {
    const { resolveAppConfig, resolveBootstrapConfig } = await import('../src/config/index.js');
    const { startConfiguredTaskHost } = await import('../src/tasks/host/host-entry.js');
    const config = resolveAppConfig({
      bootstrap: resolveBootstrapConfig({ cwd: root, environment: {} }),
      environment: { CONSOLE_LOG_LEVEL: 'error' },
    });
    await expect(
      startConfiguredTaskHost(config, {
        entry: new URL('./fixtures/logging/missing.ts', import.meta.url),
      }),
    ).rejects.toThrow();
    const logs = await readFile(
      join(config.bootstrap.dataRoot.value, 'logs/jobhunter.log'),
      'utf8',
    );
    expect(logs).toContain('host.startup_failed');
    expect(logs).toContain('missing.ts');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
