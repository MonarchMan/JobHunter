import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import {
  PlatformBrowsingService,
  createPlatformTaskHandler,
  HandlerRegistry,
  TaskService,
  WebPlatformService,
  PlatformActivityService,
} from '@jobhunter/application';
import { SystemIdGenerator, utcInstant } from '@jobhunter/domain';
import {
  PlatformError,
  platformDefinitions,
  type PlatformProviderKey,
} from '@jobhunter/platform-core';
import { createTemporaryDataRoot } from '@jobhunter/testkit';
import {
  openSqliteDatabase,
  SqlitePlatformRepository,
  SqliteTaskRepository,
  SqlitePlatformActivityRepository,
  SqlitePlatformRetentionRepository,
} from '../src/index.js';

it('isolates four providers with identical external IDs, task keys and generations', async () => {
  const root = await createTemporaryDataRoot('platform-isolation-');
  const db = openSqliteDatabase({ dataRoot: root.path });
  const ids = new SystemIdGenerator();
  const services: PlatformBrowsingService[] = [];
  try {
    const registry = new HandlerRegistry();
    const tasks = new TaskService(
      { queue: new SqliteTaskRepository(db.client), clock: { now: () => utcInstant(1000) }, ids },
      registry,
    );
    const token = randomUUID();
    const rows: {
      key: PlatformProviderKey;
      repository: SqlitePlatformRepository;
      service: PlatformBrowsingService;
      jobId: string;
      taskId: string;
      disconnect: ReturnType<typeof vi.fn>;
      web: WebPlatformService;
    }[] = [];
    // 1、四个真实仓储／任务域共享数据库，但连接器为离线替身。
    for (const key of Object.keys(platformDefinitions) as PlatformProviderKey[]) {
      const repository = new SqlitePlatformRepository(db.client, key);
      const detail = {
        externalJobId: 'same-job',
        externalCompanyId: 'same-brand',
        company: '同名公司',
        title: '测试工程师',
        city: '上海',
        salary: '',
        experience: '',
        education: '',
        sourceUrl: `${platformDefinitions[key].baseUrl}/fixture`,
        description: '这是测试职位正文。',
      };
      const disconnect = vi.fn();
      const service = new PlatformBrowsingService(
        {
          connect: () =>
            Promise.resolve({
              disconnect,
              readNext: () =>
                key === 'boss'
                  ? Promise.reject(new PlatformError('access_blocked', 37))
                  : Promise.resolve({ candidates: [detail], hasMore: true }),
              readDetail: () => Promise.resolve(detail),
            }),
        },
        repository,
        () => 1000,
      );
      services.push(service);
      registry.register(createPlatformTaskHandler(key, service));
      const web = new WebPlatformService(repository, tasks, key);
      const mutation = {
        command: { action: 'connect', portFile: '/fixture', targetId: key },
        idempotencyToken: token,
      };
      const taskId = web.mutate(mutation).taskId;
      expect(web.mutate(mutation)).toMatchObject({ taskId, kind: 'idempotent' });
      expect(web.snapshot().task?.id).toBe(taskId);
      const signal = new AbortController().signal;
      const connection = await service.execute(
        { action: 'connect', portFile: '/fixture', targetId: key },
        taskId,
        signal,
      );
      expect(connection.generation).toBe(1);
      db.client
        .prepare("UPDATE tasks SET status='running',lease_expires_at=10000 WHERE id=?")
        .run(taskId);
      const saved = await service.execute(
        { action: 'detail', generation: 1, externalJobId: 'same-job' },
        taskId,
        signal,
      );
      if (!saved.jobId) throw new Error('Missing saved job');
      expect(
        (
          await service.execute(
            { action: 'detail', generation: 1, externalJobId: 'same-job' },
            taskId,
            signal,
          )
        ).jobId,
      ).toBe(saved.jobId);
      db.client
        .prepare("UPDATE tasks SET status='succeeded',payload_json=?,result_json=? WHERE id=?")
        .run(
          JSON.stringify({ action: 'detail', generation: 1, externalJobId: 'same-job' }),
          JSON.stringify(saved),
          taskId,
        );
      rows.push({ key, repository, service, jobId: saved.jobId, taskId, disconnect, web });
    }
    expect(new Set(rows.map((row) => row.jobId)).size).toBe(4);
    for (const row of rows) expect(row.web.snapshot().saved).toEqual({ 'same-job': row.jobId });
    expect(db.client.prepare('SELECT count(DISTINCT company_id) FROM jobs').pluck().get()).toBe(4);
    expect(
      db.client.prepare('SELECT count(DISTINCT concurrency_key) FROM tasks').pluck().get(),
    ).toBe(4);
    expect(db.client.prepare('SELECT count(*) FROM job_revisions').pluck().get()).toBe(4);
    expect(db.client.prepare('SELECT count(*) FROM sync_runs').pluck().get()).toBe(0);
    expect(db.client.prepare('SELECT sum(missing_count) FROM jobs').pluck().get()).toBe(0);
    expect(
      db.client
        .prepare('SELECT count(*) FROM jobs WHERE last_interacted_at IS NOT NULL')
        .pluck()
        .get(),
    ).toBe(0);
    const [boss, zhilian] = rows;
    if (!boss || !zhilian) throw new Error('Missing provider');
    // 2、即使另一个平台任务持有有效租约，也不得借它写入当前来源。
    db.client.prepare("UPDATE tasks SET status='running' WHERE id=?").run(boss.taskId);
    expect(() =>
      zhilian.repository.save(
        {
          externalJobId: 'bad',
          externalCompanyId: 'brand',
          company: '公司',
          title: '岗位',
          city: '',
          salary: '',
          experience: '',
          education: '',
          sourceUrl: 'https://example.com',
          description: '正文',
        },
        1,
        boss.taskId,
        1000,
      ),
    ).toThrow();
    // 3、失败、断开和重启初始化只影响本平台。
    const signal = new AbortController().signal;
    await expect(
      boss.service.execute({ action: 'next', generation: 1 }, boss.taskId, signal),
    ).rejects.toMatchObject({ category: 'access_blocked' });
    expect(zhilian.repository.snapshot()).toMatchObject({ generation: 1, status: 'available' });
    await boss.service.execute({ action: 'disconnect', generation: 1 }, boss.taskId, signal);
    boss.service.initialize();
    expect(zhilian.disconnect).not.toHaveBeenCalled();
    db.client.prepare("UPDATE tasks SET status='running' WHERE id=?").run(zhilian.taskId);
    expect(
      (await zhilian.service.execute({ action: 'next', generation: 1 }, zhilian.taskId, signal))
        .candidates,
    ).toHaveLength(1);
    expect(zhilian.repository.snapshot()?.generation).toBe(1);
    expect(db.client.pragma('foreign_key_check')).toEqual([]);
  } finally {
    services.forEach((service) => {
      service.close();
    });
    db.close();
    await root.cleanup();
  }
});

it('records local activity monotonically, protects viewed jobs and only exposes safe retention state', async () => {
  const root = await createTemporaryDataRoot('platform-activity-');
  const db = openSqliteDatabase({ dataRoot: root.path });
  try {
    const repository = new SqlitePlatformRepository(db.client);
    const taskId = new SystemIdGenerator().generate();
    db.client
      .prepare(
        "INSERT INTO tasks(id,task_type,payload_json,status,idempotency_key,max_attempts,available_at,created_at,lease_expires_at) VALUES (?,'platform.boss','{}','running',?,1,0,0,10000)",
      )
      .run(taskId, taskId);
    const jobId = repository.save(
      {
        externalJobId: 'viewed',
        externalCompanyId: 'brand',
        title: '测试职位',
        company: '测试公司',
        city: '上海',
        salary: '',
        experience: '',
        education: '',
        sourceUrl: 'https://www.zhipin.com/job_detail/viewed.html',
        description: '完整的职位正文。',
      },
      repository.reset(1),
      taskId,
      1,
    );
    db.client.prepare("UPDATE tasks SET status='succeeded' WHERE id=?").run(taskId);
    const activityRepository = new SqlitePlatformActivityRepository(db.client);
    let time = 40 * 86400000;
    const activity = new PlatformActivityService(activityRepository, () => time);
    const retention = new SqlitePlatformRetentionRepository(db.client);
    expect(activity.retentionSummary().enabled).toBe(false);
    const preview = retention.execute(
      { action: 'preview', policy: { retentionDays: 30, intervalHours: 6 } },
      time,
    );
    expect(preview.eligible).toBe(1);
    expect(JSON.stringify(activity.retentionSummary())).not.toContain(preview.confirmationToken);
    expect(() => activity.touch('invalid')).toThrow();
    expect(activity.touch(jobId).updated).toBe(true);
    time -= 1000;
    activity.touch(jobId);
    expect(
      db.client.prepare('SELECT last_seen_at,last_interacted_at FROM jobs WHERE id=?').get(jobId),
    ).toEqual({ last_seen_at: 1, last_interacted_at: time + 1000 });
    if (!preview.confirmationToken) throw new Error('Missing preview');
    retention.execute(
      { action: 'enable', confirmationToken: preview.confirmationToken },
      time + 1000,
    );
    expect(activity.retentionSummary()).toEqual({
      enabled: true,
      policy: { retentionDays: 30, intervalHours: 6 },
    });
    expect(retention.execute({ action: 'run' }, time + 1000 + 6 * 3600000).deleted).toBe(0);
    expect(activity.touch(new SystemIdGenerator().generate()).updated).toBe(false);
    retention.execute({ action: 'disable' }, time + 1000);
    expect(activity.retentionSummary().enabled).toBe(false);
    expect(db.client.pragma('foreign_key_check')).toEqual([]);
  } finally {
    db.close();
    await root.cleanup();
  }
});
