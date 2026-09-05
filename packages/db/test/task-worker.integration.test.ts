import path from 'node:path';
import {
  HandlerRegistry,
  RetryPolicy,
  ScheduleService,
  TaskExecutionError,
  TaskService,
  WorkerEngine,
  nativeWorkerDelay,
  voidTaskOutputSchema,
  type EnqueueTaskResult,
  type TaskLogger,
} from '@jobhunter/application';
import { utcInstant, type UtcInstant } from '@jobhunter/domain';
import { createTemporaryDataRoot, SeededRandom } from '@jobhunter/testkit';
import { z } from 'zod';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  openSqliteDatabase,
  isSqliteBusyError,
  SqliteTaskRepository,
  type SqliteDatabaseHandle,
} from '../src/index.js';

/** 构造测试输入或执行断言的辅助逻辑。 */
class TestClock {
  #now: UtcInstant;

  public constructor(value: string | number) {
    this.#now = utcInstant(typeof value === 'string' ? new Date(value) : value);
  }

  /** 执行测试替身或时钟的操作。 */
  public now(): UtcInstant {
    return this.#now;
  }

  /** 执行测试替身或时钟的操作。 */
  public advance(milliseconds: number): void {
    this.#now = utcInstant(this.#now + milliseconds);
  }
}

/** 构造测试输入或执行断言的辅助逻辑。 */
class SequentialIds {
  #counter = 0x100;

  public generate(): string {
    const suffix = this.#counter.toString(16).padStart(12, '0');
    this.#counter += 1;
    return `018f0000-0000-7000-8000-${suffix}`;
  }
}

const roots: Awaited<ReturnType<typeof createTemporaryDataRoot>>[] = [];
const handles: SqliteDatabaseHandle[] = [];

afterEach(async () => {
  for (const handle of handles.splice(0)) handle.close();
  await Promise.all(roots.splice(0).map((root) => root.cleanup()));
});

/** 构造测试输入或执行断言的辅助逻辑。 */
async function setup(): Promise<{
  readonly handle: SqliteDatabaseHandle;
  readonly queue: SqliteTaskRepository;
  readonly clock: TestClock;
  readonly ids: SequentialIds;
}> {
  const root = await createTemporaryDataRoot('jobhunter-worker-');
  roots.push(root);
  const handle = openSqliteDatabase({ dataRoot: root.path });
  handles.push(handle);
  return {
    handle,
    queue: new SqliteTaskRepository(handle.client),
    clock: new TestClock(1_000),
    ids: new SequentialIds(),
  };
}

/** 构造测试输入或执行断言的辅助逻辑。 */
function registryWith(input: {
  readonly execute: (
    context: { readonly signal: AbortSignal },
    payload: { sourceId: string },
  ) => Promise<void> | void;
  readonly maxAttempts?: number;
}): HandlerRegistry {
  const registry = new HandlerRegistry();
  registry.register({
    taskType: 'source.sync',
    payloadSchema: z
      .object({ sourceId: z.string().min(1), secret: z.string().optional() })
      .strict(),
    outputSchema: voidTaskOutputSchema,
    defaultMaxAttempts: input.maxAttempts ?? 3,
    leaseDurationMs: 1_000,
    concurrencyKey: (payload) => `source-sync:${payload.sourceId}`,
    async execute(context, payload): Promise<void> {
      await input.execute(context, payload);
    },
  });
  return registry;
}

/** 构造测试输入或执行断言的辅助逻辑。 */
function services(
  input: Awaited<ReturnType<typeof setup>>,
  registry: HandlerRegistry,
): {
  readonly tasks: TaskService;
  readonly schedules: ScheduleService;
} {
  const dependencies = { queue: input.queue, clock: input.clock, ids: input.ids };
  return {
    tasks: new TaskService(dependencies, registry),
    schedules: new ScheduleService(dependencies, registry),
  };
}

/** 构造测试输入或执行断言的辅助逻辑。 */
function enqueueSync(tasks: TaskService, token: string, sourceId = 'source-1'): EnqueueTaskResult {
  return tasks.enqueue({
    taskType: 'source.sync',
    payload: { sourceId },
    idempotencyKey: `source.sync:${sourceId}:${token}`,
  });
}

/** 构造测试输入或执行断言的辅助逻辑。 */
function engine(
  input: Awaited<ReturnType<typeof setup>>,
  registry: HandlerRegistry,
  logger?: TaskLogger,
): WorkerEngine {
  const dependencies = { queue: input.queue, clock: input.clock, ids: input.ids };
  return new WorkerEngine({
    queue: input.queue,
    registry,
    clock: input.clock,
    isQueueBusy: isSqliteBusyError,
    retryPolicy: new RetryPolicy(new SeededRandom(42), {
      baseDelayMs: 100,
      jitterRatio: 0,
    }),
    scheduleService: new ScheduleService(dependencies, registry),
    ...(logger ? { logger } : {}),
    options: { workerId: 'worker-a', heartbeatIntervalMs: 10, shutdownGraceMs: 100 },
  });
}

describe('persistent task queue', () => {
  it('persists partial results and restores them on manual retry after reopening', async () => {
    const input = await setup();
    const registry = new HandlerRegistry();
    const payloadSchema = z.object({ resume: z.boolean().optional() });
    const resultSchema = z.object({ scoringStatus: z.literal('succeeded') });
    registry.register({
      taskType: 'test.partial',
      payloadSchema,
      outputSchema: voidTaskOutputSchema,
      defaultMaxAttempts: 2,
      leaseDurationMs: 1_000,
      retryPayload: (payload, result) => ({
        ...payloadSchema.parse(payload),
        ...(resultSchema.safeParse(result).success ? { resume: true } : {}),
      }),
      execute: (_context, payload) => {
        if (!payload.resume)
          return Promise.reject(
            new TaskExecutionError('validation_failed', '评分完成，建议生成失败', {
              result: { scoringStatus: 'succeeded' },
            }),
          );
        return Promise.resolve();
      },
    });
    const { tasks } = services(input, registry);
    const created = tasks.enqueue({
      taskType: 'test.partial',
      payload: {},
      idempotencyKey: 'partial',
    });
    await engine(input, registry).runOnce();
    expect(input.queue.get(created.task.id)).toMatchObject({
      status: 'failed',
      result: { scoringStatus: 'succeeded' },
    });
    input.handle.close();
    const reopened = openSqliteDatabase({ dataRoot: input.handle.dataRoot });
    handles.push(reopened);
    const resumed = {
      ...input,
      handle: reopened,
      queue: new SqliteTaskRepository(reopened.client),
    };
    const retried = services(resumed, registry).tasks.retryFailed(created.task.id, 'resume');
    expect(retried.task.payload).toEqual({ resume: true });
    await engine(resumed, registry).runOnce();
    expect(resumed.queue.get(retried.task.id)?.status).toBe('succeeded');
  });
  it('retries busy heartbeats but still propagates non-lock claim errors', async () => {
    const input = await setup();
    const registry = registryWith({
      execute: async () => {
        await new Promise((resolve) => setTimeout(resolve, 60));
      },
    });
    const { tasks } = services(input, registry);
    const task = enqueueSync(tasks, 'heartbeat-lock').task;
    const heartbeat = vi.spyOn(input.queue, 'heartbeat').mockImplementationOnce(() => {
      throw Object.assign(new Error('locked'), { code: 'SQLITE_BUSY' });
    });
    await engine(input, registry).runOnce();
    expect(heartbeat.mock.calls.length).toBeGreaterThan(1);
    expect(tasks.get(task.id)?.status).toBe('succeeded');
    vi.spyOn(input.queue, 'claim').mockImplementationOnce(() => {
      throw Object.assign(new Error('corrupt'), { code: 'SQLITE_CORRUPT' });
    });
    await expect(engine(input, registry).run()).rejects.toThrow('corrupt');
  });

  it('recovers a real writer lock without terminating the claim loop', async () => {
    const input = await setup();
    input.handle.client.pragma('busy_timeout=5');
    const registry = registryWith({ execute: () => undefined });
    const { tasks } = services(input, registry);
    const task = enqueueSync(tasks, 'lock-recovery').task;
    const other = openSqliteDatabase({ dataRoot: input.handle.dataRoot });
    handles.push(other);
    other.client.exec('BEGIN IMMEDIATE');
    const worker = engine(input, registry);
    const abort = new AbortController();
    const run = worker.run(abort.signal);
    try {
      await new Promise((resolve) => setTimeout(resolve, 30));
      other.client.exec('ROLLBACK');
      await vi.waitFor(
        () => {
          expect(tasks.get(task.id)?.status).toBe('succeeded');
        },
        {
          timeout: 3000,
        },
      );
    } finally {
      abort.abort();
      await run;
    }
  });

  it('leaves a busy completion for lease recovery rather than marking business failure', async () => {
    const input = await setup();
    const registry = registryWith({ execute: () => undefined });
    const { tasks } = services(input, registry);
    const task = enqueueSync(tasks, 'completion-lock').task;
    vi.spyOn(input.queue, 'complete').mockImplementationOnce(() => {
      throw Object.assign(new Error('locked'), { code: 'SQLITE_BUSY' });
    });
    expect(await engine(input, registry).runOnce()).toBe(true);
    expect(tasks.get(task.id)?.status).toBe('running');
    expect(tasks.get(task.id)?.errorCategory).toBeNull();
  });

  it('keeps scheduling during periodic work and cancels that work on shutdown', async () => {
    const input = await setup();
    const registry = registryWith({ execute: () => undefined });
    const { schedules } = services(input, registry);
    const scan = vi.spyOn(schedules, 'enqueueDue').mockImplementationOnce(() => {
      throw Object.assign(new Error('locked'), { code: 'SQLITE_BUSY' });
    });
    let cancelled = false;
    const periodicWork = vi.fn(
      (signal: AbortSignal) =>
        new Promise<void>((resolve) => {
          signal.addEventListener(
            'abort',
            () => {
              cancelled = true;
              resolve();
            },
            { once: true },
          );
        }),
    );
    const worker = new WorkerEngine({
      queue: input.queue,
      registry,
      clock: input.clock,
      retryPolicy: new RetryPolicy(new SeededRandom(42)),
      scheduleService: schedules,
      periodicWork,
      isQueueBusy: isSqliteBusyError,
      options: { workerId: 'periodic', schedulerPollMs: 5, shutdownGraceMs: 100 },
    });
    const abort = new AbortController();
    const run = worker.run(abort.signal);
    try {
      await vi.waitFor(() => {
        expect(scan.mock.calls.length).toBeGreaterThan(1);
      });
      expect(periodicWork).toHaveBeenCalledTimes(1);
    } finally {
      abort.abort();
      await run;
    }
    expect(cancelled).toBe(true);
  });

  it('validates payloads and returns deterministic idempotency and concurrency conflicts', async () => {
    const input = await setup();
    const registry = registryWith({ execute: () => undefined });
    const { tasks } = services(input, registry);

    expect(() =>
      tasks.enqueue({ taskType: 'source.sync', payload: {}, idempotencyKey: 'invalid' }),
    ).toThrow();
    const first = enqueueSync(tasks, 'manual-1');
    const duplicate = enqueueSync(tasks, 'manual-1');
    const concurrent = enqueueSync(tasks, 'manual-2');
    expect(first.kind).toBe('enqueued');
    expect(duplicate.kind).toBe('idempotent');
    expect(duplicate.task.id).toBe(first.task.id);
    expect(concurrent.kind).toBe('concurrency_conflict');
    expect(input.queue.summary(input.clock.now())).toMatchObject({ pending: 1, running: 0 });
  });

  it('allows only one claimant across two database connections', async () => {
    const input = await setup();
    const registry = registryWith({ execute: () => undefined });
    const { tasks } = services(input, registry);
    enqueueSync(tasks, 'claim');

    const secondHandle = openSqliteDatabase({ dataRoot: path.dirname(input.handle.databasePath) });
    handles.push(secondHandle);
    const secondQueue = new SqliteTaskRepository(secondHandle.client);
    const claims = [input.queue, secondQueue].map((queue, index) =>
      queue.claim({
        taskType: 'source.sync',
        workerId: `worker-${String(index)}`,
        now: input.clock.now(),
        leaseDurationMsFor: () => 1_000,
      }),
    );
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(claims[0]?.attemptCount).toBe(1);
  });

  it('recovers an expired lease and fails it after attempts are exhausted', async () => {
    const input = await setup();
    const registry = registryWith({ execute: () => undefined, maxAttempts: 2 });
    const { tasks } = services(input, registry);
    const queued = enqueueSync(tasks, 'recover');
    const first = input.queue.claim({
      taskType: 'source.sync',
      workerId: 'crashed-worker',
      now: input.clock.now(),
      leaseDurationMsFor: () => 1_000,
    });
    expect(first?.id).toBe(queued.task.id);

    input.clock.advance(1_001);
    expect(input.queue.complete(queued.task.id, 'crashed-worker', input.clock.now())).toBe(false);
    const recovered = input.queue.claim({
      taskType: 'source.sync',
      workerId: 'replacement-worker',
      now: input.clock.now(),
      leaseDurationMsFor: () => 1_000,
    });
    expect(recovered).toMatchObject({ id: queued.task.id, attemptCount: 2 });

    input.clock.advance(1_001);
    expect(
      input.queue.claim({
        taskType: 'source.sync',
        workerId: 'third-worker',
        now: input.clock.now(),
        leaseDurationMsFor: () => 1_000,
      }),
    ).toBeNull();
    expect(input.queue.get(queued.task.id)).toMatchObject({
      status: 'failed',
      errorCategory: 'permanent',
    });
  });

  it('reports cancellation across processes on heartbeat and rejects cancelling success', async () => {
    const input = await setup();
    const registry = registryWith({ execute: () => undefined });
    const { tasks } = services(input, registry);
    const pending = enqueueSync(tasks, 'cancel-pending');
    expect(tasks.cancel(pending.task.id).kind).toBe('cancelled');

    const running = enqueueSync(tasks, 'cancel-running');
    input.queue.claim({
      taskType: 'source.sync',
      workerId: 'worker-a',
      now: input.clock.now(),
      leaseDurationMsFor: () => 1_000,
    });
    expect(tasks.cancel(running.task.id).kind).toBe('cancel_requested');
    expect(
      input.queue.heartbeat({
        taskId: running.task.id,
        workerId: 'worker-a',
        now: input.clock.now(),
        leaseDurationMs: 1_000,
      }),
    ).toEqual({ ownsLease: true, cancelRequested: true });
    input.queue.markCancelled(running.task.id, 'worker-a', input.clock.now());

    const succeeded = enqueueSync(tasks, 'success');
    input.queue.claim({
      taskType: 'source.sync',
      workerId: 'worker-a',
      now: input.clock.now(),
      leaseDurationMsFor: () => 1_000,
    });
    input.queue.complete(succeeded.task.id, 'worker-a', input.clock.now());
    expect(tasks.cancel(succeeded.task.id).kind).toBe('not_cancellable');
  });

  it('creates a linked task when a failed task is manually retried', async () => {
    const input = await setup();
    const registry = registryWith({ execute: () => undefined });
    const { tasks } = services(input, registry);
    const failed = enqueueSync(tasks, 'failed');
    input.queue.claim({
      taskType: 'source.sync',
      workerId: 'worker-a',
      now: input.clock.now(),
      leaseDurationMsFor: () => 1_000,
    });
    input.queue.fail({
      taskId: failed.task.id,
      workerId: 'worker-a',
      finishedAt: input.clock.now(),
      category: 'permanent',
      summary: 'Non-retryable.',
    });

    const retry = tasks.retryFailed(failed.task.id, 'user-1');
    expect(retry).toMatchObject({ kind: 'enqueued', task: { retryOfTaskId: failed.task.id } });
    expect(tasks.retryFailed(failed.task.id, 'user-1').kind).toBe('idempotent');
  });
});

describe('scheduler', () => {
  it('enqueues only the latest missed occurrence and remains idempotent after restart', async () => {
    const input = await setup();
    const clock = new TestClock('2026-01-01T00:00:00.000Z');
    const registry = registryWith({ execute: () => undefined });
    const dependencies = { queue: input.queue, clock, ids: input.ids };
    const scheduler = new ScheduleService(dependencies, registry);
    const schedule = scheduler.upsert({
      id: input.ids.generate(),
      scheduleKey: 'daily-source-1',
      taskType: 'source.sync',
      payload: { sourceId: 'source-1' },
      cronExpression: '0 9 * * *',
      timezone: 'Asia/Shanghai',
    });
    expect(schedule.nextRunAt).toBe(new Date('2026-01-01T01:00:00.000Z').valueOf());

    clock.advance(3 * 24 * 60 * 60 * 1_000 + 2 * 60 * 60 * 1_000);
    const restarted = new ScheduleService(dependencies, registry);
    restarted.upsert({
      id: input.ids.generate(),
      scheduleKey: 'daily-source-1',
      taskType: 'source.sync',
      payload: { sourceId: 'source-1' },
      cronExpression: '0 9 * * *',
      timezone: 'Asia/Shanghai',
    });
    const first = restarted.enqueueDue();
    expect(first).toHaveLength(1);
    expect(input.queue.list({})).toHaveLength(1);
    expect(input.queue.dueSchedules(clock.now(), 10)).toHaveLength(0);

    expect(restarted.enqueueDue()).toHaveLength(0);
    expect(input.queue.list({})).toHaveLength(1);
    expect(first[0]?.task.idempotencyKey).toContain(
      String(new Date('2026-01-04T01:00:00Z').valueOf()),
    );
  });

  it('advances a source schedule without duplicating an active source task', async () => {
    const input = await setup();
    const registry = registryWith({ execute: () => undefined });
    const { tasks, schedules } = services(input, registry);
    enqueueSync(tasks, 'manual');
    schedules.upsert({
      id: input.ids.generate(),
      scheduleKey: 'each-second-source-1',
      taskType: 'source.sync',
      payload: { sourceId: 'source-1' },
      cronExpression: '* * * * * *',
      timezone: 'UTC',
    });
    input.clock.advance(1_000);

    const [result] = schedules.enqueueDue();
    expect(result?.kind).toBe('concurrency_conflict');
    expect(input.queue.list({})).toHaveLength(1);
  });
});

describe('worker execution', () => {
  it('runs the configured number of consumers for one task type', async () => {
    const input = await setup();
    let started = 0;
    let resolveBothStarted!: () => void;
    let release!: () => void;
    const bothStarted = new Promise<void>((resolve) => {
      resolveBothStarted = resolve;
    });
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const registry = new HandlerRegistry();
    registry.register({
      taskType: 'fixture.concurrent',
      payloadSchema: z.object({ id: z.string() }).strict(),
      outputSchema: voidTaskOutputSchema,
      defaultMaxAttempts: 1,
      leaseDurationMs: 1_000,
      execute(): Promise<void> {
        started += 1;
        if (started === 2) resolveBothStarted();
        return released;
      },
    });
    const tasks = new TaskService(
      { queue: input.queue, clock: input.clock, ids: input.ids },
      registry,
    );
    for (const id of ['first', 'second']) {
      tasks.enqueue({
        taskType: 'fixture.concurrent',
        payload: { id },
        idempotencyKey: `fixture.concurrent:${id}`,
      });
    }
    const worker = new WorkerEngine({
      queue: input.queue,
      registry,
      clock: input.clock,
      retryPolicy: new RetryPolicy(new SeededRandom(42)),
      scheduleService: new ScheduleService(
        { queue: input.queue, clock: input.clock, ids: input.ids },
        registry,
      ),
      workerDelay: nativeWorkerDelay,
      options: {
        workerId: 'worker-concurrent',
        taskTypeConcurrency: { 'fixture.concurrent': 2 },
        emptyPollMinimumMs: 1,
        emptyPollMaximumMs: 5,
        schedulerPollMs: 100,
        shutdownGraceMs: 100,
      },
    });
    const running = worker.run();
    await bothStarted;
    expect(started).toBe(2);
    release();
    await new Promise((resolve) => setTimeout(resolve, 10));
    await worker.shutdown();
    await running;
  }, 10_000);

  it('runs independent task-type claim loops without one blocked type starving another', async () => {
    const input = await setup();
    let releaseSource!: () => void;
    let sourceStarted!: () => void;
    let sourceFinished!: () => void;
    let enrichFinished!: () => void;
    const sourceStartedPromise = new Promise<void>((resolve) => {
      sourceStarted = resolve;
    });
    const sourceRelease = new Promise<void>((resolve) => {
      releaseSource = resolve;
    });
    const sourceFinishedPromise = new Promise<void>((resolve) => {
      sourceFinished = resolve;
    });
    const enrichFinishedPromise = new Promise<void>((resolve) => {
      enrichFinished = resolve;
    });
    const registry = new HandlerRegistry();
    registry.register({
      taskType: 'source.sync',
      payloadSchema: z.object({ sourceId: z.string().min(1) }).strict(),
      outputSchema: voidTaskOutputSchema,
      defaultMaxAttempts: 1,
      leaseDurationMs: 1_000,
      async execute(): Promise<void> {
        sourceStarted();
        await sourceRelease;
        sourceFinished();
      },
    });
    registry.register({
      taskType: 'job.enrich',
      payloadSchema: z.object({ jobId: z.string().min(1) }).strict(),
      outputSchema: voidTaskOutputSchema,
      defaultMaxAttempts: 1,
      leaseDurationMs: 1_000,
      execute(): Promise<void> {
        enrichFinished();
        return Promise.resolve();
      },
    });
    const tasks = new TaskService(
      { queue: input.queue, clock: input.clock, ids: input.ids },
      registry,
    );
    const sourceTask = tasks.enqueue({
      taskType: 'source.sync',
      payload: { sourceId: 'source-independent' },
      idempotencyKey: 'independent-source',
    });
    const enrichTask = tasks.enqueue({
      taskType: 'job.enrich',
      payload: { jobId: 'job-independent' },
      idempotencyKey: 'independent-job',
    });
    expect(sourceTask.kind).toBe('enqueued');
    expect(enrichTask.kind).toBe('enqueued');

    const worker = new WorkerEngine({
      queue: input.queue,
      registry,
      clock: input.clock,
      retryPolicy: new RetryPolicy(new SeededRandom(42), { baseDelayMs: 100, jitterRatio: 0 }),
      scheduleService: new ScheduleService(
        { queue: input.queue, clock: input.clock, ids: input.ids },
        registry,
      ),
      workerDelay: nativeWorkerDelay,
      options: {
        workerId: 'worker-independent',
        emptyPollMinimumMs: 1,
        emptyPollMaximumMs: 5,
        schedulerPollMs: 100,
        shutdownGraceMs: 100,
      },
    });
    const running = worker.run();
    await sourceStartedPromise;
    await enrichFinishedPromise;
    expect(input.queue.get(enrichTask.task.id)?.status).toBe('succeeded');
    expect(input.queue.get(sourceTask.task.id)?.status).toBe('running');
    releaseSource();
    await sourceFinishedPromise;
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(input.queue.get(sourceTask.task.id)?.status).toBe('succeeded');
    await worker.shutdown();
    await running;
  }, 10_000);

  it('respects Retry-After and does not retry a permanent error', async () => {
    const retryInput = await setup();
    const retryRegistry = registryWith({
      execute: () => {
        throw new TaskExecutionError('rate_limited', 'Rate limited.', {
          retryAfterAt: utcInstant(10_000),
        });
      },
    });
    const retryTasks = services(retryInput, retryRegistry).tasks;
    const retryTask = enqueueSync(retryTasks, 'rate-limit');
    await engine(retryInput, retryRegistry).runOnce();
    expect(retryInput.queue.get(retryTask.task.id)).toMatchObject({
      status: 'pending',
      availableAt: 10_000,
      errorCategory: 'rate_limited',
    });

    const permanentInput = await setup();
    const secret = 'resume-private-body';
    const logs: string[] = [];
    const logger: TaskLogger = {
      info: (event, fields) => logs.push(JSON.stringify({ event, fields })),
      warn: (event, fields) => logs.push(JSON.stringify({ event, fields })),
      error: (event, fields) => logs.push(JSON.stringify({ event, fields })),
    };
    const permanentRegistry = registryWith({
      execute: () => {
        throw new Error(secret);
      },
    });
    const permanentTasks = services(permanentInput, permanentRegistry).tasks;
    const permanentTask = permanentTasks.enqueue({
      taskType: 'source.sync',
      payload: { sourceId: 'source-2', secret },
      idempotencyKey: 'secret-task',
    });
    await engine(permanentInput, permanentRegistry, logger).runOnce();
    expect(permanentInput.queue.get(permanentTask.task.id)).toMatchObject({
      status: 'failed',
      errorCategory: 'permanent',
      errorSummary: 'Task handler failed.',
    });
    expect(logs.join('\n')).not.toContain(secret);
  });

  it('immediately aborts a running local handler on user cancellation', async () => {
    const input = await setup();
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    const registry = registryWith({
      execute: async ({ signal }) => {
        started();
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              reject(new Error('aborted'));
            },
            { once: true },
          );
        });
      },
    });
    const worker = engine(input, registry);
    const tasks = new TaskService(
      { queue: input.queue, clock: input.clock, ids: input.ids },
      registry,
      worker,
    );
    const task = enqueueSync(tasks, 'cancel-local');
    const running = worker.runOnce();
    await startedPromise;
    expect(tasks.cancel(task.task.id).kind).toBe('cancel_requested');
    await running;
    expect(input.queue.get(task.task.id)?.status).toBe('cancelled');
  });

  it('finalizes cancellation requested after the handler finishes but before task completion', async () => {
    const input = await setup();
    const registry = new HandlerRegistry();
    registry.register({
      taskType: 'source.sync',
      payloadSchema: z.object({ sourceId: z.string().min(1) }).strict(),
      outputSchema: voidTaskOutputSchema,
      defaultMaxAttempts: 1,
      leaseDurationMs: 1_000,
      execute(context): Promise<void> {
        if (!context.taskId) throw new Error('Worker task identity is unavailable.');
        input.queue.cancel(context.taskId, input.clock.now());
        return Promise.resolve();
      },
    });
    const tasks = services(input, registry).tasks;
    const task = enqueueSync(tasks, 'cancel-completion-gap');

    await engine(input, registry).runOnce();

    const cancelled = input.queue.get(task.task.id);
    expect(cancelled?.status).toBe('cancelled');
    expect(cancelled?.cancelRequestedAt).not.toBeNull();
  });

  it('keeps a committed handler result visible when cancellation arrives after its commit', async () => {
    const input = await setup();
    const registry = new HandlerRegistry();
    registry.register({
      taskType: 'source.sync',
      payloadSchema: z.object({ sourceId: z.string().min(1) }).strict(),
      outputSchema: voidTaskOutputSchema,
      defaultMaxAttempts: 1,
      leaseDurationMs: 1_000,
      lateCancellationPolicy: 'complete',
      execute(context): Promise<void> {
        if (!context.taskId) throw new Error('Worker task identity is unavailable.');
        input.queue.cancel(context.taskId, input.clock.now());
        return Promise.resolve();
      },
    });
    const tasks = services(input, registry).tasks;
    const task = enqueueSync(tasks, 'late-cancel-after-commit');

    await engine(input, registry).runOnce();

    const completed = input.queue.get(task.task.id);
    expect(completed?.status).toBe('succeeded');
    expect(completed?.cancelRequestedAt).not.toBeNull();
  });

  it('resolves late cancellation from the validated handler output', async () => {
    const input = await setup();
    const registry = new HandlerRegistry();
    registry.register({
      taskType: 'source.sync',
      payloadSchema: z.object({ sourceId: z.enum(['no-op', 'committed']) }).strict(),
      outputSchema: z.object({ committed: z.boolean() }).strict(),
      defaultMaxAttempts: 1,
      leaseDurationMs: 1_000,
      lateCancellationPolicy: (output) => (output.committed ? 'complete' : 'cancel'),
      execute(context, payload): Promise<{ readonly committed: boolean }> {
        if (!context.taskId) throw new Error('Worker task identity is unavailable.');
        input.queue.cancel(context.taskId, input.clock.now());
        return Promise.resolve({ committed: payload.sourceId === 'committed' });
      },
    });
    const tasks = services(input, registry).tasks;
    const noOp = enqueueSync(tasks, 'output-aware-no-op', 'no-op');

    await engine(input, registry).runOnce();

    expect(input.queue.get(noOp.task.id)?.status).toBe('cancelled');

    const committed = enqueueSync(tasks, 'output-aware-commit', 'committed');
    await engine(input, registry).runOnce();

    const completed = input.queue.get(committed.task.id);
    expect(completed?.status).toBe('succeeded');
    expect(completed?.cancelRequestedAt).not.toBeNull();
  });

  it('stops claiming and leaves shutdown-interrupted work for lease recovery', async () => {
    const input = await setup();
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    const registry = registryWith({
      execute: async ({ signal }) => {
        started();
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              reject(new Error('shutdown'));
            },
            { once: true },
          );
        });
      },
    });
    const tasks = services(input, registry).tasks;
    const first = enqueueSync(tasks, 'shutdown-1');
    const worker = engine(input, registry);
    const running = worker.runOnce();
    await startedPromise;
    await worker.shutdown();
    await running;
    expect(input.queue.get(first.task.id)).toMatchObject({
      status: 'running',
      leaseOwner: 'worker-a',
    });
    expect(await worker.runOnce()).toBe(false);
  });
});
