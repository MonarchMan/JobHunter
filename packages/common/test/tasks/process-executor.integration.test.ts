import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { ProcessTaskExecutor } from '../../src/tasks/process-executor.js';
import { AsyncSemaphore } from '../../src/tasks/async-semaphore.js';
import { parseId, utcInstant } from '../../src/domain/index.js';
import type { TaskHandlerContext, TaskRecord } from '../../src/tasks/model.js';

const pools: ProcessTaskExecutor[] = [];
afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.close()));
});

/** 真实子进程验证分派和跨进程许可，使用合成任务避免访问外部网络。 */
function fixture(): {
  pool: ProcessTaskExecutor;
  task: TaskRecord;
  context: TaskHandlerContext;
  network: AsyncSemaphore;
} {
  const network = new AsyncSemaphore(1);
  const pool = new ProcessTaskExecutor(
    () =>
      fork(fileURLToPath(new URL('../fixtures/task-executor.ts', import.meta.url)), [], {
        execArgv: ['--import', 'tsx', '--conditions=development'],
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      }),
    network,
  );
  pools.push(pool);
  const context: TaskHandlerContext = {
    signal: new AbortController().signal,
    clock: { now: () => utcInstant(Date.now()) },
    logger: {
      info() {
        /* 测试不输出日志。 */
      },
      warn() {
        /* 测试不输出日志。 */
      },
      error() {
        /* 测试不输出日志。 */
      },
    },
    services: {},
  };
  const task: TaskRecord = {
    id: parseId('018f0000-0000-7000-8000-000000000001', 'Task'),
    taskType: 'fixture.echo',
    payload: { text: 'fixture' },
    status: 'running',
    priority: 0,
    idempotencyKey: 'fixture',
    concurrencyKey: null,
    retryOfTaskId: null,
    attemptCount: 1,
    maxAttempts: 3,
    availableAt: utcInstant(0),
    leaseOwner: 'dispatch',
    leaseExpiresAt: utcInstant(Date.now() + 120_000),
    lastHeartbeatAt: null,
    cancelRequestedAt: null,
    errorCategory: null,
    errorSummary: null,
    createdAt: utcInstant(0),
    startedAt: utcInstant(0),
    finishedAt: null,
  };
  return { pool, task, context, network };
}

it('executes in separate processes while respecting one global network permit', async () => {
  const { pool, task, context, network } = fixture();
  const results = (await Promise.all([
    pool.execute(task, context),
    pool.execute({ ...task, taskType: 'other.echo' }, context),
  ])) as { pid: number; started: number; finished: number; payload: unknown }[];
  expect(new Set(results.map((result) => result.pid)).size).toBe(2);
  expect(results.every((result) => result.pid !== process.pid)).toBe(true);
  results.sort((a, b) => a.started - b.started);
  const [first, second] = results;
  if (!first || !second) throw new Error('Missing executor results');
  expect(second.started).toBeGreaterThanOrEqual(first.finished);
  expect(network.activeCount).toBe(0);
});

it('reports executor death and recreates the process for a new dispatch', async () => {
  const { pool, task, context } = fixture();
  await expect(pool.execute({ ...task, taskType: 'fixture.crash' }, context)).rejects.toMatchObject(
    { category: 'network_temporary' },
  );
  await expect(pool.execute(task, context)).resolves.toMatchObject({ payload: task.payload });
});

it('aborts assigned work without stopping the shared executor', async () => {
  const { pool, task, context } = fixture();
  const abort = new AbortController();
  const result = pool.execute(task, { ...context, signal: abort.signal });
  abort.abort();
  await expect(result).rejects.toMatchObject({ category: 'cancelled' });
  await expect(pool.execute(task, context)).resolves.toMatchObject({ payload: task.payload });
});
