import { expect, it } from 'vitest';
import { z } from 'zod';
import { createTemporaryDataRoot } from '@jobhunter/common/testing';
import { createTaskRuntime } from '@jobhunter/common/task-runtime';
import { voidTaskOutputSchema } from '@jobhunter/common/tasks';
import { openSqliteDatabase } from '@jobhunter/common/persistence/connection';

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
