import { expect, it, vi } from 'vitest';
import { Worker } from 'node:worker_threads';
import { z } from 'zod';
import { createTemporaryDataRoot } from '@jobhunter/common/testing';
import { createTaskRuntime } from '@jobhunter/common/task-runtime';
import { voidTaskOutputSchema } from '@jobhunter/common/tasks';
import { openSqliteDatabase } from '@jobhunter/common/persistence/connection';
import { SqliteTaskRepository } from '@jobhunter/common/persistence/tasks';
import { utcInstant } from '@jobhunter/common/domain';
import { ThreadTaskExecutor } from '../../src/tasks/execution/thread-executor.js';
import { AsyncSemaphore } from '../../src/tasks/concurrency/async-semaphore.js';
import { defineAgent } from '../../src/agent/index.js';
import type { TaskRuntimeContext } from '../../src/tasks/host/runtime.js';

it('persists a running request before a model response crosses the concurrency limiter', async () => {
  const root = await createTemporaryDataRoot('jobhunter-runtime-model-observer-');
  const deferred = {
    started: (): void => undefined,
    finish: (response: Response): void => {
      void response;
    },
  };
  const started = new Promise<void>((resolve) => {
    deferred.started = resolve;
  });
  const response = new Promise<Response>((resolve) => {
    deferred.finish = resolve;
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      deferred.started();
      return response;
    }),
  );
  const capture: { context?: TaskRuntimeContext } = {};
  const application = createTaskRuntime(
    {
      dataRoot: root.path,
      periodicEnabled: false,
      model: {
        provider: 'openai-compatible',
        baseUrl: 'https://fixture.test/v1',
        apiKey: 'synthetic',
        model: 'fixture',
      },
    },
    [
      (context) => {
        capture.context = context;
        return { close: () => Promise.resolve() };
      },
    ],
  );
  const runner = capture.context?.runner;
  const client = capture.context?.database.client;
  if (!runner || !client) throw new Error('Missing fixture runtime');
  const pending = runner.run({
    definition: defineAgent({
      key: 'observer-fixture',
      outputSchemaVersion: '1',
      outputSchemaName: 'Fixture',
      systemPrompt: 'Synthetic observer fixture',
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      tools: [],
      limits: {
        timeoutMs: 10000,
        maxSteps: 1,
        maxInputTokens: 1000,
        maxOutputTokens: 100,
        maxEstimatedCostMicros: 1000,
      },
    }),
    value: {},
    signal: new AbortController().signal,
  });
  try {
    await started;
    const request = client.prepare('SELECT id,state FROM model_requests').get() as {
      id: string;
      state: string;
    };
    expect(request.state).toBe('running');
    deferred.finish(
      Response.json({
        choices: [{ message: { content: '{"ok":true}' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
    );
    const result = await pending;
    expect(result.output).toEqual({ ok: true });
    expect(client.prepare('SELECT id,state FROM model_requests').all()).toEqual([
      { id: request.id, state: 'completed' },
    ]);
    expect(result.run.requestIds).toEqual([request.id]);
  } finally {
    deferred.finish(Response.json({ choices: [{ message: { content: '{"ok":true}' } }] }));
    await pending.catch(() => undefined);
    await application.close();
    vi.unstubAllGlobals();
    await root.cleanup();
  }
});

it.each(['SQLITE_BUSY_SNAPSHOT', 'maintenance'])(
  'recovers wrapped storage failures through the real pool instead of permanently failing: %s',
  async (code) => {
    const root = await createTemporaryDataRoot('jobhunter-thread-storage-recovery-');
    const entry = new URL('../fixtures/task-executor.ts', import.meta.url).href;
    const pool = new ThreadTaskExecutor(
      () =>
        new Worker(
          `require('tsx/esm/api').tsImport(${JSON.stringify(entry)}, require('node:url').pathToFileURL(process.cwd()+'/').href)`,
          { eval: true, execArgv: ['--conditions=development'] },
        ),
      new AsyncSemaphore(1),
    );
    const application = createTaskRuntime(
      { dataRoot: root.path, executor: pool, periodicEnabled: false },
      [
        ({ registry }) => {
          registry.register({
            taskType: 'fixture.storage-error',
            payloadSchema: z.object({ code: z.string() }),
            outputSchema: z.unknown(),
            defaultMaxAttempts: 2,
            leaseDurationMs: 10_000,
            execute: () => Promise.reject(new Error('Must execute in a worker thread')),
          });
          return { close: () => pool.close() };
        },
      ],
    );
    const database = openSqliteDatabase({ dataRoot: root.path });
    try {
      await pool.initialize();
      const queued = application.request?.('enqueue', {
        taskType: 'fixture.storage-error',
        payload: { code },
        idempotencyKey: 'storage-recovery',
      }) as { taskId: string };
      // 1、第一轮错误跨线程返回后停止续租，不写成业务永久失败。
      expect(await application.engine.runOnce()).toBe(true);
      expect(application.request?.('query', { taskId: queued.taskId })).toMatchObject({
        status: 'running',
        attemptCount: 1,
        errorCategory: null,
      });
      // 2、仅推进合成任务的过期租约，验证既有恢复路径可以再次领取并成功。
      database.client
        .prepare('UPDATE tasks SET lease_expires_at = 0 WHERE id = ?')
        .run(queued.taskId);
      expect(
        new SqliteTaskRepository(database.client).recoverExpired(utcInstant(Date.now())),
      ).toEqual({
        recovered: 1,
        exhausted: 0,
      });
      expect(await application.engine.runOnce()).toBe(true);
      expect(application.request?.('query', { taskId: queued.taskId })).toMatchObject({
        status: 'succeeded',
        attemptCount: 2,
      });
    } finally {
      database.close();
      await application.close();
      await root.cleanup();
    }
  },
);

it('does not claim without pool capacity and follows only the selected workflow children', async () => {
  const root = await createTemporaryDataRoot('jobhunter-runtime-workflow-');
  let allowed: string[] = [];
  let capacity = false;
  let enqueue!: (kind: string, key: string) => string;
  let childId = '';
  const application = createTaskRuntime(
    {
      dataRoot: root.path,
      periodicEnabled: false,
      rootTaskIds: () => allowed,
      executor: {
        reserve() {
          return capacity
            ? {
                execute: (_task, context) => {
                  if (_task.taskType === 'fixture.parent')
                    childId = enqueue('fixture.child', 'child');
                  context.signal.throwIfAborted();
                  return Promise.resolve();
                },
                release() {
                  /* synthetic reservation */
                },
              }
            : undefined;
        },
        execute: () => Promise.reject(new Error('Unreserved execution')),
      },
    },
    [
      (context) => {
        enqueue = (kind, key) =>
          context.tasks.enqueue({ taskType: kind, payload: {}, idempotencyKey: key }).task.id;
        for (const taskType of ['fixture.parent', 'fixture.child'])
          context.registry.register({
            taskType,
            payloadSchema: z.object({}),
            outputSchema: voidTaskOutputSchema,
            defaultMaxAttempts: 1,
            leaseDurationMs: 10_000,
            execute: () => Promise.resolve(),
          });
        return { close: () => Promise.resolve() };
      },
    ],
  );
  try {
    const selected = enqueue('fixture.parent', 'selected');
    const unrelated = enqueue('fixture.parent', 'unrelated');
    allowed = [selected];
    expect(await application.engine.runOnce('fixture.parent')).toBe(false);
    expect(application.request?.('query', { taskId: selected })).toMatchObject({
      status: 'pending',
      attemptCount: 0,
    });
    capacity = true;
    expect(await application.engine.runOnce('fixture.parent')).toBe(true);
    expect(childId).not.toBe('');
    expect(await application.engine.runOnce('fixture.child')).toBe(true);
    expect(await application.engine.runOnce('fixture.parent')).toBe(false);
    expect(application.request?.('workflow', [selected])).toHaveLength(2);
    expect(application.request?.('query', { taskId: unrelated })).toMatchObject({
      status: 'pending',
      attemptCount: 0,
    });
  } finally {
    await application.close();
    await root.cleanup();
  }
});

it('registers every module before schedules initialize and closes modules in reverse order', async () => {
  const root = await createTemporaryDataRoot('jobhunter-runtime-modules-');
  const events: string[] = [];
  const application = createTaskRuntime({ dataRoot: root.path }, [
    (context) => ({
      initialize() {
        // 1、初始化可以使用后续模块登记的任务，不依赖工厂排列顺序。
        context.tasks.enqueue({ taskType: 'fixture.echo', payload: {}, idempotencyKey: 'fixture' });
        events.push('initialized');
      },
      close() {
        events.push('first.closed');
        return Promise.resolve();
      },
    }),
    (context) => {
      context.registry.register({
        taskType: 'fixture.echo',
        payloadSchema: z.object({}),
        outputSchema: voidTaskOutputSchema,
        defaultMaxAttempts: 1,
        leaseDurationMs: 1_000,
        execute() {
          events.push('executed');
          return Promise.resolve();
        },
      });
      return {
        close() {
          events.push('second.closed');
          return Promise.resolve();
        },
      };
    },
  ]);
  try {
    expect(await application.engine.runOnce('fixture.echo')).toBe(true);
    await Promise.all([application.close(), application.close()]);
    expect(events).toEqual(['initialized', 'executed', 'second.closed', 'first.closed']);
  } finally {
    await application.close();
    await root.cleanup();
  }
});

it('releases all modules and the database even when a module close fails', async () => {
  const root = await createTemporaryDataRoot('jobhunter-runtime-close-failure-');
  let firstClosed = false;
  const application = createTaskRuntime({ dataRoot: root.path }, [
    () => ({
      close() {
        firstClosed = true;
        return Promise.resolve();
      },
    }),
    () => ({
      close() {
        return Promise.reject(new Error('fixture close failed'));
      },
    }),
  ]);
  try {
    await expect(application.close()).rejects.toBeInstanceOf(AggregateError);
    expect(firstClosed).toBe(true);
    // 1、关闭失败也不保留数据库连接，下一宿主可以重新打开。
    const database = openSqliteDatabase({ dataRoot: root.path });
    database.close();
  } finally {
    await root.cleanup();
  }
});
