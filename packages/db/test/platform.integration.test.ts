import { randomUUID } from 'node:crypto';
import {
  BossPlatformService,
  bossResultSchema,
  createBossPlatformTaskHandler,
  HandlerRegistry,
  TaskService,
  ScheduleService,
  RetryPolicy,
  WorkerEngine,
  WebBossService,
} from '@jobhunter/application';
import { SystemIdGenerator, utcInstant } from '@jobhunter/domain';
import { createTemporaryDataRoot } from '@jobhunter/testkit';
import { expect, it } from 'vitest';
import {
  openSqliteDatabase,
  SqlitePlatformRepository,
  SqliteTaskRepository,
  SqliteCleanupRepository,
} from '../src/index.js';

it('connects, reads and saves into permanent jobs without official synchronization', async () => {
  const root = await createTemporaryDataRoot('boss-flow-');
  const db = openSqliteDatabase({ dataRoot: root.path });
  const repository = new SqlitePlatformRepository(db.client);
  const detail = {
    externalJobId: 'job1',
    externalCompanyId: 'brand~~',
    title: '开发工程师',
    company: '测试公司',
    city: '上海',
    salary: '20-30K',
    experience: '3年',
    education: '本科',
    sourceUrl: 'https://www.zhipin.com/job_detail/job1.html',
    description: '开发与维护业务系统。',
  };
  let disconnected = 0;
  const service = new BossPlatformService(
    {
      connect() {
        return Promise.resolve({
          readNext() {
            const { description: _description, ...candidate } = detail;
            void _description;
            return Promise.resolve({ candidates: [candidate], hasMore: false });
          },
          readDetail() {
            return Promise.resolve(detail);
          },
          disconnect() {
            disconnected++;
          },
        });
      },
    },
    repository,
    () => 1000,
  );
  const signal = new AbortController().signal;
  // 1、使用真实迁移和租约任务，只有连接替身，不访问用户浏览器。
  const task = (): string => {
    const id = new SystemIdGenerator().generate();
    db.client
      .prepare(
        "INSERT INTO tasks(id,task_type,payload_json,status,idempotency_key,max_attempts,available_at,created_at,lease_expires_at) VALUES (?,'platform.boss','{}','running',?,1,0,0,10000)",
      )
      .run(id, id);
    return id;
  };
  try {
    const connection = await service.execute(
      { action: 'connect', portFile: '/unused/DevToolsActivePort', targetId: 'target' },
      task(),
      signal,
    );
    const generation = connection.generation;
    await expect(
      service.execute({ action: 'next', generation: generation + 1 }, task(), signal),
    ).rejects.toThrow();
    expect(disconnected).toBe(0);
    expect(
      (await service.execute({ action: 'next', generation }, task(), signal)).candidates,
    ).toHaveLength(1);
    expect(db.client.prepare('SELECT count(*) FROM jobs').pluck().get()).toBe(0);
    const first = await service.execute(
      { action: 'detail', generation, externalJobId: 'job1' },
      task(),
      signal,
    );
    const second = await service.execute(
      { action: 'detail', generation, externalJobId: 'job1' },
      task(),
      signal,
    );
    expect(second.jobId).toBe(first.jobId);
    expect(db.client.prepare('SELECT count(*) FROM jobs').pluck().get()).toBe(1);
    expect(db.client.prepare('SELECT count(*) FROM job_revisions').pluck().get()).toBe(1);
    expect(
      db.client
        .prepare(
          'SELECT count(*) FROM job_observations WHERE sync_run_id IS NULL AND platform_task_id IS NOT NULL',
        )
        .pluck()
        .get(),
    ).toBe(2);
    expect(db.client.prepare('SELECT count(*) FROM sync_runs').pluck().get()).toBe(0);
    expect(db.client.prepare('SELECT missing_count FROM jobs').pluck().get()).toBe(0);
    // 2、取消、租约过期与重启均不能写入或复用内存会话。
    const cancelled = task();
    db.client.prepare('UPDATE tasks SET cancel_requested_at=1 WHERE id=?').run(cancelled);
    expect(() => repository.save(detail, generation, cancelled, 1000)).toThrow();
    expect(() => repository.save(detail, generation, task(), 20000)).toThrow();
    service.close();
    await expect(service.execute({ action: 'next', generation }, task(), signal)).rejects.toThrow();
    expect(db.client.pragma('foreign_key_check')).toEqual([]);
    expect(
      new SqliteCleanupRepository(db.client).listCandidates({
        observationsBefore: utcInstant(20000),
        sourceDetailsBefore: utcInstant(20000),
        agentRunsBefore: utcInstant(20000),
      }),
    ).toEqual([]);
    // 3、再通过真实队列与 Worker 引擎执行连接、列表、详情，核验持久任务结果。
    db.client.prepare("UPDATE tasks SET status='succeeded'").run();
    const queue = new SqliteTaskRepository(db.client);
    const registry = new HandlerRegistry();
    registry.register(createBossPlatformTaskHandler(service));
    const dependencies = {
      queue,
      clock: { now: () => utcInstant(1000) },
      ids: new SystemIdGenerator(),
    };
    const tasks = new TaskService(dependencies, registry);
    const web = new WebBossService(repository, tasks);
    const worker = new WorkerEngine({
      queue,
      registry,
      clock: dependencies.clock,
      retryPolicy: new RetryPolicy({ next: () => 0.5 }),
      scheduleService: new ScheduleService(dependencies, registry),
      options: { workerId: 'boss-test' },
    });
    try {
      let liveGeneration = 0;
      for (const action of ['connect', 'next', 'detail'] as const) {
        const payload =
          action === 'connect'
            ? { action, portFile: '/unused/DevToolsActivePort', targetId: 'target' }
            : action === 'next'
              ? { action, generation: liveGeneration }
              : { action, generation: liveGeneration, externalJobId: 'job1' };
        const mutation = { command: payload, idempotencyToken: randomUUID() };
        const submitted = web.mutate(mutation);
        expect(web.mutate(mutation)).toEqual({ ...submitted, kind: 'idempotent' });
        expect(web.snapshot().task?.status).toBe('pending');
        expect(await worker.runOnce('platform.boss')).toBe(true);
        const result = tasks
          .list({ taskType: 'platform.boss' })
          .find((item) => item.id === submitted.taskId);
        expect(result?.status).toBe('succeeded');
        liveGeneration = bossResultSchema.parse(result?.result).generation;
      }
      expect(web.snapshot().batch?.candidates).toHaveLength(1);
      expect(web.snapshot().saved.job1).toBe(first.jobId);
      expect(JSON.stringify(web.snapshot())).not.toContain('/unused');
      service.initialize();
      expect(web.snapshot().connection?.status).toBe('disconnected');
      expect(web.snapshot().batch).toBeNull();
      expect(web.snapshot().saved).toEqual({});
    } finally {
      await worker.shutdown();
    }
  } finally {
    service.close();
    db.close();
    await root.cleanup();
  }
});
