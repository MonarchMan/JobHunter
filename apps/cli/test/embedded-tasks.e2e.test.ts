import { describe, expect, it } from 'vitest';
import { createTemporaryDataRoot } from '@jobhunter/common/testing';
import { openSqliteDatabase } from '@jobhunter/common/persistence/connection';
import { SqliteTaskRepository } from '@jobhunter/common/persistence/tasks';
import { parseId, utcInstant } from '@jobhunter/common/domain';
import { resolveAppConfig, resolveBootstrapConfig } from '@jobhunter/common/config/index';
import { createLocalCliContainer } from '../src/container.js';

it('CLI waits execute queued work without an independent worker and release the runtime', async () => {
  const root = await createTemporaryDataRoot('jobhunter-cli-embedded-');
  const bootstrap = resolveBootstrapConfig({
    cli: { dataRoot: root.path },
    environment: {},
    cwd: root.path,
  });
  const container = createLocalCliContainer(resolveAppConfig({ bootstrap, environment: {} }));
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
      scheduleId: null,
      retryOfTaskId: null,
      maxAttempts: 1,
      availableAt: utcInstant(1),
      createdAt: utcInstant(1),
    });
    // 2、没有 Web 和 Worker，等待操作自身消费并结束任务。
    if (!container.task) throw new Error('Task services were not composed');
    await expect(container.task.wait(taskId, AbortSignal.timeout(15_000))).resolves.toMatchObject({
      status: 'failed',
      errorCategory: 'cancelled',
    });
    // 3、关闭幂等，退出后允许直接重新打开数据库。
    await container.close();
    await container.close();
    expect(queue.get(taskId)?.status).toBe('failed');
  } finally {
    await container.close();
    database.close();
    await root.cleanup();
  }
});

describe('CLI query startup', () => {
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
        expect(database.client.prepare('SELECT count(*) AS count FROM schedules').get()).toEqual({
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
