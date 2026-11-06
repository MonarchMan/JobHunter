import { afterEach, describe, expect, it } from 'vitest';
import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import {
  ThreadTaskExecutor,
  threadPoolOptionsSchema,
} from '../../src/tasks/execution/thread-executor.js';
import { AsyncSemaphore } from '../../src/tasks/concurrency/async-semaphore.js';
import type { TaskRecord, TaskHandlerContext } from '../../src/tasks/contracts/model.js';

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Expected available capacity');
  return value;
}
const pools: ThreadTaskExecutor[] = [];
afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.close()));
});

/** 合成线程不访问数据库、浏览器或模型，保留真实消息与退出语义。 */
function createPool(
  options: ConstructorParameters<typeof ThreadTaskExecutor>[2] = {},
  code?: string,
): ThreadTaskExecutor {
  const pool = new ThreadTaskExecutor(
    () =>
      new Worker(
        code ??
          `
    const {parentPort:p,threadId}=require('node:worker_threads');
    const timers=new Map();
    p.on('message',m=>{
      if(m.kind==='execute') timers.set(m.id,setTimeout(()=>{p.postMessage({kind:'result',id:m.id,value:threadId});timers.delete(m.id)},m.task.payload.delay||10));
      if(m.kind==='abort'){clearTimeout(timers.get(m.id));timers.delete(m.id);p.postMessage({kind:'error',id:m.id,category:'cancelled',summary:'cancelled',retryable:false,retryAfterAt:null})}
      if(m.kind==='shutdown'){for(const t of timers.values())clearTimeout(t);p.close()}
    });p.postMessage({kind:'ready'});
  `,
        { eval: true },
      ),
    new AsyncSemaphore(1),
    { scaleUpCooldownMs: 0, idleTimeoutMs: 150, shutdownGraceMs: 100, ...options },
  );
  pools.push(pool);
  return pool;
}

function task(milliseconds = 10): TaskRecord {
  return {
    id: randomUUID(),
    taskType: 'test',
    leaseOwner: randomUUID(),
    status: 'running',
    attemptCount: 1,
    payload: { delay: milliseconds },
  } as unknown as TaskRecord;
}
function context(signal = new AbortController().signal): TaskHandlerContext {
  return {
    signal,
    clock: { now: () => Date.now() },
    services: {},
    logger: {
      info() {
        /* fixture */
      },
      warn() {
        /* fixture */
      },
      error() {
        /* fixture */
      },
    },
  } as TaskHandlerContext;
}
async function until(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('condition timed out');
    await delay(10);
  }
}

describe('bounded task thread pool', () => {
  it('shares global network permits and source tokens across real application threads', async () => {
    const network = new AsyncSemaphore(1);
    const entry = new URL('../fixtures/task-executor.ts', import.meta.url).href;
    const pool = new ThreadTaskExecutor(
      () =>
        new Worker(
          `require('tsx/esm/api').tsImport(${JSON.stringify(entry)}, require('node:url').pathToFileURL(process.cwd()+'/').href)`,
          { eval: true, execArgv: ['--conditions=development'] },
        ),
      network,
      { minThreads: 2, maxThreads: 2, maxTasksPerThread: 1, scaleUpCooldownMs: 0 },
    );
    pools.push(pool);
    await pool.initialize();
    const one = required(pool.reserve('fixture.throttle'));
    const two = required(pool.reserve('fixture.throttle'));
    const results = (await Promise.all([
      one.execute({ ...task(), taskType: 'fixture.throttle' }, context()),
      two.execute({ ...task(), taskType: 'fixture.throttle' }, context()),
    ])) as { threadId: number; pid: number; started: number; finished: number }[];
    one.release();
    two.release();
    results.sort((a, b) => a.started - b.started);
    expect(required(results[0]).pid).toBe(process.pid);
    expect(required(results[0]).threadId).not.toBe(required(results[1]).threadId);
    expect(required(results[1]).started).toBeGreaterThanOrEqual(required(results[0]).finished);
    expect(required(results[1]).started - required(results[0]).started).toBeGreaterThanOrEqual(80);
    expect(network.activeCount).toBe(0);
    expect(network.queuedCount).toBe(0);
  });
  it('validates bounds and supports a fixed pool', () => {
    expect(() => threadPoolOptionsSchema.parse({ minThreads: 3, maxThreads: 2 })).toThrow();
    expect(threadPoolOptionsSchema.parse({ minThreads: 2, maxThreads: 2 }).maxThreads).toBe(2);
  });
  it('reserves capacity before execution and releases idempotently', async () => {
    const pool = createPool({ maxThreads: 1, maxTasksPerThread: 2, maxActiveTasks: 2 });
    expect(pool.reserve('test')).toBeUndefined();
    await until(() => !!pool.threadCount);
    await pool.initialize();
    const first = required(pool.reserve('test'));
    const second = required(pool.reserve('test'));
    expect(pool.reserve('test')).toBeUndefined();
    const result = await Promise.all([
      first.execute(task(), context()),
      second.execute(task(), context()),
    ]);
    expect(result[0]).toBe(result[1]);
    first.release();
    first.release();
    second.release();
    expect(pool.activeCount).toBe(0);
  });
  it('expands at capacity and drains only unpinned idle threads', async () => {
    const pool = createPool({ maxTasksPerThread: 1, maxActiveTasks: 2, maxThreads: 2 });
    await pool.initialize();
    const first = required(pool.reserve('test', 'session'));
    const work = first.execute(task(200), context());
    expect(pool.reserve('test')).toBeUndefined();
    await until(() => pool.threadCount === 2);
    let second = pool.reserve('test');
    while (!second) {
      await delay(10);
      second = pool.reserve('test');
    }
    const otherId = await second.execute(task(), context());
    second.release();
    const firstId = await work;
    first.release();
    expect(otherId).not.toBe(firstId);
    await until(() => pool.threadCount === 1);
    const same = required(pool.reserve('test', 'session'));
    expect(await same.execute(task(), context())).toBe(firstId);
    same.release();
    pool.releaseAffinity('session');
  });
  it('cancels work and closes without leaving workers', async () => {
    const pool = createPool();
    await pool.initialize();
    const controller = new AbortController();
    const reserved = required(pool.reserve('test'));
    const work = reserved.execute(task(10_000), context(controller.signal));
    controller.abort();
    await expect(work).rejects.toThrow();
    reserved.release();
    await Promise.all([pool.close(), pool.close()]);
    expect(pool.threadCount).toBe(0);
  });
  it('terminates an unresponsive worker before rejecting execution', async () => {
    const pool = createPool(
      {},
      `const {parentPort:p}=require('node:worker_threads');p.on('message',m=>{if(m.kind==='execute')while(true){}});p.postMessage({kind:'ready'});`,
    );
    await pool.initialize();
    const controller = new AbortController();
    const reserved = required(pool.reserve('test'));
    const work = reserved.execute(task(), context(controller.signal));
    controller.abort();
    await expect(work).rejects.toThrow('exited');
    reserved.release();
    expect(pool.threadCount).toBe(0);
  });
  it('fails initialization when a worker never becomes ready', async () => {
    const pool = createPool(
      { startupTimeoutMs: 100 },
      `require('node:worker_threads').parentPort.on('message',()=>{});`,
    );
    await expect(pool.initialize()).rejects.toThrow('startup timed out');
  });
});
