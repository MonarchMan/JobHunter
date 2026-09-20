import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import {
  PlatformBrowsingService,
  createPlatformTaskHandler,
  HandlerRegistry,
  TaskService,
  ScheduleService,
  RetryPolicy,
  WorkerEngine,
  WebPlatformService,
  bossResultSchema,
  type BossCommand,
  type BossResult,
} from '@jobhunter/application';
import {
  openSqliteDatabase,
  SqlitePlatformRepository,
  SqliteTaskRepository,
  SqliteJobQueryRepository,
} from '@jobhunter/db';
import { SystemIdGenerator, utcInstant, parseId } from '@jobhunter/domain';
import {
  ZhilianCampusSelectionSession,
  ZhilianCampusHttpSession,
} from '@jobhunter/platform-connectors';

/** 合成 HTTP 响应通过真实 Worker／SQLite，不访问平台或用户浏览器。 */
it.each(['selection', 'recommendation'] as const)(
  'saves a Zhilian job through isolated worker tasks: %s',
  async (mode) => {
    const root = await mkdtemp(path.join(tmpdir(), 'zhilian-selection-test-'));
    const db = openSqliteDatabase({ dataRoot: root });
    const selection = { externalJobId: 'CC_TEST', title: '研发实习生', company: '测试企业' };
    let reads = 0;
    const fetcher: typeof fetch = (input) => {
      reads++;
      if (typeof input === 'string' && input.includes('/searchRecommendCampusPcSubject'))
        return Promise.resolve(
          new Response(
            JSON.stringify({
              statusCode: 200,
              data: {
                isEndPage: 1,
                list: [
                  {
                    number: 'CC_TEST',
                    name: '研发实习生',
                    companyNumber: 'KA_TEST',
                    companyName: '测试企业',
                    workCity: '成都',
                    salary60: '面议',
                    education: '本科',
                    workingExp: '',
                  },
                ],
              },
            }),
          ),
        );
      return Promise.resolve(
        new Response(
          JSON.stringify({
            statusCode: 200,
            data: {
              positionDetail: {
                positionNumber: 'CC_TEST',
                positionName: '研发实习生',
                jobDesc: '开发系统。<br>编写测试。',
                positionWorkCity: '成都',
                positionWorkingExp: '',
                salary60: '面议',
                education: '本科',
              },
              companyDetail: { companyNumber: 'KA_TEST', companyName: '测试企业' },
            },
          }),
        ),
      );
    };
    let now = 0;
    const auth = { at: 'test-private-at', rt: 'test-private-rt', d: 'test-private-d' };
    const session =
      mode === 'selection'
        ? new ZhilianCampusSelectionSession({ selection, auth, fetch: fetcher })
        : new ZhilianCampusHttpSession({
            fetch: fetcher,
            now: () => (now += 30_001),
            template: {
              url: 'https://cgate.zhaopin.com/positionbusiness/searchRecommendCampus/searchRecommendCampusPcSubject',
              headers: {
                'x-zp-at': auth.at,
                'x-zp-rt': auth.rt,
                'x-zp-platform': '14',
                'x-zp-business-system': '40',
              },
              body: JSON.stringify({
                ...auth,
                identity: '1',
                filterMinSalary: 1,
                resumeNumber: 'reference',
                subjectType: 1,
                eventScenario: 'campusPcRecommend',
                pageIndex: 1,
                pageSize: 20,
                browsedJobNumbers: '',
                clickedJobNumbers: [],
                channel: 'xiaoyuan',
                platform: '14',
                version: '0.0.0',
              }),
            },
          });
    const repository = new SqlitePlatformRepository(db.client, 'zhilian');
    const service = new PlatformBrowsingService(
      { connect: () => Promise.resolve(session) },
      repository,
    );
    const registry = new HandlerRegistry();
    registry.register(createPlatformTaskHandler('zhilian', service));
    const queue = new SqliteTaskRepository(db.client);
    const deps = {
      queue,
      clock: { now: () => utcInstant(Date.now()) },
      ids: new SystemIdGenerator(),
    };
    const tasks = new TaskService(deps, registry);
    const web = new WebPlatformService(repository, tasks, 'zhilian');
    const worker = new WorkerEngine({
      queue,
      registry,
      clock: deps.clock,
      retryPolicy: new RetryPolicy({ next: () => 0.5 }),
      scheduleService: new ScheduleService(deps, registry),
      options: { workerId: 'zhilian-test' },
    });
    /** 通过应用层发布和消费，禁止测试直接写 jobs 伪造闭环。 */
    const run = async (command: BossCommand): Promise<BossResult> => {
      const submitted = web.mutate({ command, idempotencyToken: randomUUID() });
      expect(await worker.runOnce('platform.zhilian')).toBe(true);
      const task = tasks.get(parseId(submitted.taskId, 'Task'));
      expect(task?.status).toBe('succeeded');
      return bossResultSchema.parse(task?.result);
    };
    try {
      // 1、候选阶段不入库，只有显式详情消费才保存正式职位。
      const { generation } = await run({
        action: 'connect',
        portFile: '/test/DevToolsActivePort',
        targetId: 'synthetic',
      });
      await run({ action: 'next', generation });
      expect(db.client.prepare('SELECT count(*) FROM jobs').pluck().get()).toBe(0);
      const saved = await run({
        action: 'detail',
        generation,
        externalJobId: selection.externalJobId,
      });
      if (!saved.jobId) throw new Error('Missing saved job ID');
      expect(
        new SqliteJobQueryRepository(db.client).get(parseId(saved.jobId, 'Job')),
      ).not.toBeNull();
      const repeated = await run({
        action: 'detail',
        generation,
        externalJobId: selection.externalJobId,
      });
      expect(repeated.jobId).toBe(saved.jobId);
      expect(reads).toBe(mode === 'selection' ? 1 : 3);
      // 2、共享持久化不触发官网缺失标记，也不能污染 BOSS 的工作集。
      expect(db.client.prepare('SELECT count(*) FROM jobs').pluck().get()).toBe(1);
      expect(db.client.prepare('SELECT count(*) FROM sync_runs').pluck().get()).toBe(0);
      expect(db.client.prepare('SELECT missing_count FROM jobs').pluck().get()).toBe(0);
      expect(db.client.pragma('foreign_key_check')).toEqual([]);
      expect(
        new WebPlatformService(
          new SqlitePlatformRepository(db.client, 'boss'),
          tasks,
          'boss',
        ).snapshot().batch,
      ).toBeNull();
      // 3、扫描本链路所有持久化表，令牌不得进入任务、职位或观察。
      for (const table of [
        'jobs',
        'job_revisions',
        'job_observations',
        'tasks',
        'platform_connections',
      ])
        expect(JSON.stringify(db.client.prepare(`SELECT * FROM ${table}`).all())).not.toContain(
          'test-private-',
        );
      await run({ action: 'disconnect', generation });
      expect(web.snapshot().connection?.status).toBe('disconnected');
    } finally {
      await worker.shutdown();
      service.close();
      db.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);
