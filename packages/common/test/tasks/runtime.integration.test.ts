import { expect, it } from 'vitest';
import { z } from 'zod';
import { createTemporaryDataRoot } from '@jobhunter/common/testing';
import { createTaskRuntime } from '@jobhunter/common/task-runtime';
import { voidTaskOutputSchema } from '@jobhunter/common/tasks';
import { openSqliteDatabase } from '@jobhunter/common/persistence/connection';

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
