import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { expect, it } from 'vitest';
import { createTemporaryDataRoot } from '@jobhunter/testkit';
import { createProductionWorkerApplication } from '@jobhunter/worker';
import { openSqliteDatabase, SqliteTaskRepository, SqlitePlatformRepository } from '@jobhunter/db';
import { parseId, SystemIdGenerator } from '@jobhunter/domain';
import { platformRetentionResultSchema } from '@jobhunter/application';

const execute = promisify(execFile);

it('BOSS 恢复 CLI 必须显式确认并保留原失败任务引用，其他平台不得发布', async () => {
  const root = await createTemporaryDataRoot('platform-resume-cli-');
  const db = openSqliteDatabase({ dataRoot: root.path });
  const sourceTaskId = new SystemIdGenerator().generate();
  const args = [
    path.resolve(import.meta.dirname, '../dist/platform-main.js'),
    '--data-root',
    root.path,
    '--provider',
    'boss',
    'resume',
    '--generation',
    '1',
    '--source-task-id',
    sourceTaskId,
  ];
  try {
    // 1、未确认官网恢复或平台不支持时，不得发布后台请求。
    await expect(execute(process.execPath, args)).rejects.toThrow();
    await expect(
      execute(
        process.execPath,
        args.map((value) => (value === 'boss' ? 'zhilian' : value)).concat('--browser-recovered'),
      ),
    ).rejects.toThrow();
    expect(db.client.prepare('SELECT count(*) FROM tasks').pluck().get()).toBe(0);
    // 2、显式确认仅发布任务，不在 CLI 内连接浏览器或请求职位。
    const { stdout } = await execute(process.execPath, [...args, '--browser-recovered']);
    const submitted = JSON.parse(stdout) as { task: { id: string } };
    const task = new SqliteTaskRepository(db.client).get(parseId(submitted.task.id, 'Task'));
    expect(task).toMatchObject({
      status: 'pending',
      payload: { action: 'resume', generation: 1, sourceTaskId, browserRecovered: true },
    });
  } finally {
    db.close();
    await root.cleanup();
  }
});

it('四平台 CLI 观察分别识别末批且不会创建详情或干扰另一平台失败', async () => {
  const root = await createTemporaryDataRoot('platform-observation-isolated-');
  const db = openSqliteDatabase({ dataRoot: root.path });
  try {
    for (const provider of ['boss', 'zhilian', '51job', 'liepin'] as const) {
      const repository = new SqlitePlatformRepository(db.client, provider);
      repository.reset(Date.now());
      repository.setStatus(1, 'available', Date.now());
      const id = new SystemIdGenerator().generate();
      db.client
        .prepare(
          `INSERT INTO tasks(id,task_type,payload_json,status,idempotency_key,max_attempts,available_at,created_at,result_json)
        VALUES (?,?,?,'succeeded',?,1,0,0,?)`,
        )
        .run(
          id,
          `platform.${provider}`,
          JSON.stringify({ action: 'next', generation: 1 }),
          `${provider}:stability:1:0:next`,
          JSON.stringify({
            generation: 1,
            status: 'available',
            candidates: [],
            savedCount: 0,
            hasMore: false,
          }),
        );
    }
    db.client
      .prepare(
        `INSERT INTO tasks(id,task_type,payload_json,status,idempotency_key,max_attempts,available_at,created_at)
      VALUES (?,'platform.boss','{}','failed',?,1,0,1)`,
      )
      .run(new SystemIdGenerator().generate(), crypto.randomUUID());
    for (const provider of ['boss', 'zhilian', '51job', 'liepin']) {
      const result = await execute(process.execPath, [
        path.resolve(import.meta.dirname, '../dist/platform-stability-main.js'),
        '--provider',
        provider,
        '--data-root',
        root.path,
        '--generation',
        '1',
        '--round',
        '1',
        '--not-before',
        new Date(Date.now() - 1000).toISOString(),
        '--deadline',
        new Date(Date.now() + 60000).toISOString(),
      ]);
      expect(JSON.parse(result.stdout)).toMatchObject({
        provider,
        status: 'exhausted',
        detailVerified: false,
      });
    }
    expect(db.client.prepare('SELECT count(*) FROM tasks').pluck().get()).toBe(5);
  } finally {
    db.close();
    await root.cleanup();
  }
});

it('publishes preview, confirms and disables retention through real CLI and production Worker', async () => {
  const root = await createTemporaryDataRoot('platform-cli-');
  const worker = createProductionWorkerApplication({ dataRoot: root.path });
  const db = openSqliteDatabase({ dataRoot: root.path });
  /** CLI 只创建任务，真实生产处理器执行控制变更，不接触浏览器。 */
  const run = async (
    args: string[],
  ): Promise<ReturnType<typeof platformRetentionResultSchema.parse>> => {
    const result = await execute(process.execPath, [
      path.resolve(import.meta.dirname, '../dist/platform-main.js'),
      '--data-root',
      root.path,
      ...args,
    ]);
    const submitted = JSON.parse(result.stdout) as { task: { id: string } };
    expect(await worker.engine.runOnce('platform.retention')).toBe(true);
    const task = new SqliteTaskRepository(db.client).get(parseId(submitted.task.id, 'Task'));
    expect(task?.status).toBe('succeeded');
    return platformRetentionResultSchema.parse(task?.result);
  };
  try {
    expect((await run(['retention-status'])).enabled).toBe(false);
    const preview = await run(['retention-preview', '--days', '45', '--interval-hours', '12']);
    if (!preview.confirmationToken) throw new Error('Missing preview');
    expect(
      await run(['retention-enable', '--confirmation-token', preview.confirmationToken]),
    ).toMatchObject({
      enabled: true,
      policy: { retentionDays: 45, intervalHours: 12 },
      deleted: 0,
    });
    expect((await run(['retention-disable'])).enabled).toBe(false);
    expect(
      db.client
        .prepare("SELECT count(*) FROM schedules WHERE task_type='platform.retention'")
        .pluck()
        .get(),
    ).toBe(1);
  } finally {
    await worker.close();
    db.close();
    await root.cleanup();
  }
});

it('does not enqueue an observation outside its window or after an incomplete previous round', async () => {
  const root = await createTemporaryDataRoot('platform-observation-');
  const db = openSqliteDatabase({ dataRoot: root.path });
  const repository = new SqlitePlatformRepository(db.client);
  repository.reset(Date.now());
  repository.setStatus(1, 'connected', Date.now());
  const args = [
    path.resolve(import.meta.dirname, '../dist/platform-stability-main.js'),
    '--data-root',
    root.path,
    '--generation',
    '1',
    '--round',
    '1',
  ];
  try {
    await expect(
      execute(process.execPath, [
        ...args,
        '--not-before',
        new Date(Date.now() + 60000).toISOString(),
        '--deadline',
        new Date(Date.now() + 120000).toISOString(),
      ]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('Outside observation window') as unknown,
    });
    await expect(
      execute(process.execPath, [
        ...args,
        '--not-before',
        new Date(Date.now() - 1000).toISOString(),
        '--deadline',
        new Date(Date.now() + 60000).toISOString(),
      ]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('Previous observation did not complete') as unknown,
    });
    expect(db.client.prepare('SELECT count(*) FROM tasks').pluck().get()).toBe(0);
  } finally {
    db.close();
    await root.cleanup();
  }
});
