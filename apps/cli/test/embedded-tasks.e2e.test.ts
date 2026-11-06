import { periodicConfigProjection } from '@jobhunter/common/persistence/periodic-config';
import { describe, expect, it } from 'vitest';
import { setTimeout } from 'node:timers/promises';
import { createTemporaryDataRoot } from '@jobhunter/common/testing';
import { openSqliteDatabase } from '@jobhunter/common/persistence/connection';
import { SqliteTaskRepository } from '@jobhunter/common/persistence/tasks';
import { parseId, utcInstant } from '@jobhunter/common/domain';
import { resolveAppConfig, resolveBootstrapConfig } from '@jobhunter/common/config/index';
import { requestTaskService, taskHostConfiguration } from '@jobhunter/common/task-host-runtime';
import { createLocalCliContainer } from '../src/container.js';

it('CLI executes a target workflow in owned threads and closing removes its bridge', async () => {
  const root = await createTemporaryDataRoot('jobhunter-cli-embedded-');
  const bootstrap = resolveBootstrapConfig({
    cli: { dataRoot: root.path },
    environment: {},
    cwd: root.path,
  });
  const config = resolveAppConfig({
    bootstrap,
    environment: { TASK_THREAD_POOL: '{"startupTimeoutMs":90000}' },
  });
  const container = createLocalCliContainer(config, { workspaceRoot: root.path });
  const serviceInput = { dataRoot: root.path, configuration: taskHostConfiguration(config) };
  const database = openSqliteDatabase({ dataRoot: root.path });
  const queue = new SqliteTaskRepository(database.client);
  const taskId = parseId('018f0000-0000-7000-8000-00000000d101', 'Task');
  try {
    // 1、失效研究上下文会在本地校验失败，不调用外部模型或浏览器。
    queue.enqueue({
      id: taskId,
      taskType: 'interview.experience-research.execute',
      payload: {
        requestId: '018f0000-0000-7000-8000-00000000d102',
        requestFingerprint: 'a'.repeat(64),
        expectedRevision: 0,
        executorKey: 'configured-model',
      },
      priority: 0,
      idempotencyKey: 'embedded-cli',
      concurrencyKey: null,
      retryOfTaskId: null,
      maxAttempts: 1,
      availableAt: utcInstant(1),
      createdAt: utcInstant(1),
    });
    // 2、没有 Web 时由 CLI 按需启动中央服务，任务仍在执行子进程中消费。
    if (!container.task) throw new Error('Task services were not composed');
    await expect(container.task.wait(taskId, AbortSignal.timeout(90_000))).resolves.toMatchObject({
      status: 'failed',
      errorCategory: 'cancelled',
    });
    // 3、关闭幂等，退出后允许直接重新打开数据库。
    await container.close();
    await container.close();
    expect(queue.get(taskId)?.status).toBe('failed');
    await expect(requestTaskService({ ...serviceInput, method: 'ping' })).rejects.toThrow();
  } finally {
    await container.close();
    database.close();
    await root.cleanup();
  }
}, 180_000);

describe('CLI query startup', () => {
  it('does not consume unrelated historical tasks', async () => {
    const root = await createTemporaryDataRoot('jobhunter-cli-scope-');
    const config = resolveAppConfig({
      bootstrap: resolveBootstrapConfig({
        cli: { dataRoot: root.path },
        environment: {},
        cwd: root.path,
      }),
      environment: { TASK_THREAD_POOL: '{"startupTimeoutMs":90000}' },
    });
    const database = openSqliteDatabase({ dataRoot: root.path });
    const queue = new SqliteTaskRepository(database.client);
    const container = createLocalCliContainer(config, { workspaceRoot: root.path });
    const target = parseId('018f0000-0000-7000-8000-00000000d301', 'Task');
    const unrelated = parseId('018f0000-0000-7000-8000-00000000d302', 'Task');
    for (const id of [target, unrelated])
      queue.enqueue({
        id,
        taskType: 'interview.experience-research.execute',
        payload: {
          requestId: id,
          requestFingerprint: 'a'.repeat(64),
          expectedRevision: 0,
          executorKey: 'configured-model',
        },
        priority: 0,
        idempotencyKey: id,
        concurrencyKey: null,
        retryOfTaskId: null,
        maxAttempts: 1,
        availableAt: utcInstant(1),
        createdAt: utcInstant(1),
      });
    try {
      if (!container.task) throw new Error('Missing task service');
      await container.task.wait(target, AbortSignal.timeout(90_000));
      expect(queue.get(target)?.status).toBe('failed');
      await setTimeout(200);
      expect(queue.get(unrelated)?.status).toBe('pending');
    } finally {
      await container.close();
      database.close();
      await root.cleanup();
    }
  }, 180_000);

  it('does not create task schedules for a query-only container', async () => {
    const root = await createTemporaryDataRoot('jobhunter-cli-query-only-');
    const bootstrap = resolveBootstrapConfig({
      cli: { dataRoot: root.path },
      environment: {},
      cwd: root.path,
    });
    const container = createLocalCliContainer(resolveAppConfig({ bootstrap, environment: {} }));
    try {
      openSqliteDatabase({ dataRoot: root.path }).close();
      container.task?.list({});
      const database = openSqliteDatabase({ dataRoot: root.path });
      try {
        expect(
          database.client
            .prepare(`SELECT count(*) AS count FROM ${periodicConfigProjection}`)
            .get(),
        ).toEqual({
          count: 0,
        });
      } finally {
        database.close();
      }
    } finally {
      await container.close();
      await root.cleanup();
    }
  });
});
