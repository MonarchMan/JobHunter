import { periodicConfigProjection } from '@jobhunter/common/persistence/periodic-config';
import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { createTemporaryDataRoot } from '@jobhunter/common/testing';
import { openSqliteDatabase } from '@jobhunter/common/persistence/connection';
import { SqliteTaskRepository } from '@jobhunter/common/persistence/tasks';
import { parseId, utcInstant } from '@jobhunter/common/domain';
import { resolveAppConfig, resolveBootstrapConfig } from '@jobhunter/common/config/index';
import { requestTaskService, taskServiceConfiguration } from '@jobhunter/common/task-service';
import { createLocalCliContainer } from '../src/container.js';

it('CLI waits use the shared service and closing the client keeps it available', async () => {
  const root = await createTemporaryDataRoot('jobhunter-cli-embedded-');
  const bootstrap = resolveBootstrapConfig({
    cli: { dataRoot: root.path },
    environment: {},
    cwd: root.path,
  });
  const config = resolveAppConfig({ bootstrap, environment: {} });
  const container = createLocalCliContainer(config, { workspaceRoot: root.path });
  const serviceInput = { dataRoot: root.path, configuration: taskServiceConfiguration(config) };
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
    await expect(
      container.task.wait(taskId, AbortSignal.timeout(15_000)).catch(async (error: unknown) => {
        throw new Error(await readFile(path.join(root.path, 'logs/task-service.log'), 'utf8'), {
          cause: error,
        });
      }),
    ).resolves.toMatchObject({
      status: 'failed',
      errorCategory: 'cancelled',
    });
    // 3、关闭幂等，退出后允许直接重新打开数据库。
    await container.close();
    await container.close();
    expect(queue.get(taskId)?.status).toBe('failed');
    await expect(requestTaskService({ ...serviceInput, method: 'ping' })).resolves.toBeDefined();
  } finally {
    await container.close();
    await requestTaskService({ ...serviceInput, method: 'shutdown' }).catch(() => undefined);
    database.close();
    await root.cleanup();
  }
});

describe('CLI query startup', () => {
  it('starts the service at initialization and consumes work after the CLI closes without waiting', async () => {
    const root = await createTemporaryDataRoot('jobhunter-cli-background-');
    const bootstrap = resolveBootstrapConfig({
      cli: { dataRoot: root.path },
      environment: {},
      cwd: root.path,
    });
    const config = resolveAppConfig({ bootstrap, environment: {} });
    const container = createLocalCliContainer(config, { workspaceRoot: root.path });
    const serviceInput = { dataRoot: root.path, configuration: taskServiceConfiguration(config) };
    let database: ReturnType<typeof openSqliteDatabase> | undefined;
    try {
      await expect(container.taskService?.status()).resolves.toEqual({ status: 'unavailable' });
      await container.initialize?.run();
      await expect(container.taskService?.status()).resolves.toEqual({ status: 'ready' });
      await container.taskService?.stop();
      await expect(container.taskService?.status()).resolves.toEqual({ status: 'unavailable' });
      await container.taskService?.restart();
      await expect(container.taskService?.status()).resolves.toEqual({ status: 'ready' });
      await container.close();
      await expect(requestTaskService({ ...serviceInput, method: 'ping' })).resolves.toBeDefined();
      database = openSqliteDatabase({ dataRoot: root.path });
      const queue = new SqliteTaskRepository(database.client);
      const taskId = parseId('018f0000-0000-7000-8000-00000000d201', 'Task');
      queue.enqueue({
        id: taskId,
        taskType: 'interview.experience-research.execute',
        payload: {
          requestId: '018f0000-0000-7000-8000-00000000d202',
          requestFingerprint: 'a'.repeat(64),
          expectedRevision: 0,
          executorKey: 'configured-model',
        },
        priority: 0,
        idempotencyKey: 'background-cli',
        concurrencyKey: null,
        retryOfTaskId: null,
        maxAttempts: 1,
        availableAt: utcInstant(1),
        createdAt: utcInstant(1),
      });
      // 不调用 CLI wait：独立服务自行分派，失效上下文在外部调用前确定失败。
      const deadline = Date.now() + 15_000;
      while (
        ['pending', 'running'].includes(queue.get(taskId)?.status ?? '') &&
        Date.now() < deadline
      )
        await setTimeout(50);
      expect(queue.get(taskId)).toMatchObject({
        status: 'failed',
        errorCategory: 'cancelled',
        attemptCount: 1,
      });
    } finally {
      await container.close();
      await requestTaskService({ ...serviceInput, method: 'shutdown' }).catch(() => undefined);
      database?.close();
      await root.cleanup();
    }
  });

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
