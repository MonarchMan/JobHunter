import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  LiepinRecommendationHttpSession,
  LiepinCdpSessionProvider,
} from '@jobhunter/platform-connectors';
import { createProductionWorkerApplication } from '../src/index.js';
import {
  createPlatformTaskHandler,
  HandlerRegistry,
  TaskService,
  WebPlatformService,
  WebJobQueryService,
  JobQueryService,
  webJobQuerySchema,
  type BossCommand,
} from '@jobhunter/application';
import {
  openSqliteDatabase,
  SqlitePlatformRepository,
  SqliteTaskRepository,
  SqliteJobQueryRepository,
  SqliteCompanyLookupRepository,
} from '@jobhunter/db';
import { SystemIdGenerator, utcInstant, parseId } from '@jobhunter/domain';

/** 上游采用合成协议，真实 Worker／隔离 SQLite／职位页查询覆盖正式生命周期。 */
it('猎聘 HTTP 批次自动入库，官网和其他平台查询保持隔离', async () => {
  const dataRoot = await mkdtemp(path.join(tmpdir(), 'liepin-flow-'));
  const db = openSqliteDatabase({ dataRoot });
  let now = 0;
  let requests = 0;
  const url = 'https://www.liepin.com/job/1980000001.shtml';
  const title = '开发实习生';
  const company = '测试公司';
  const description = '参与业务系统开发、测试与文档编写，学习工程协作规范。';
  const session = new LiepinRecommendationHttpSession({
    template: {
      url: 'https://api-c.liepin.com/api/com.liepin.csearch.home-recommend-job-new',
      body: JSON.stringify({
        data: {
          operateKind: 'LOGIN',
          sortType: 'PC_STU_HP_MIX',
          selectedExpect: '{}',
          existFallbackResult: false,
        },
      }),
    },
    readHeaders: () => Promise.resolve({ cookie: 'session=private-liepin-fixture' }),
    now: () => (now += 5001),
    fetch: (_url, init) => {
      requests++;
      return Promise.resolve(
        init?.method === 'POST'
          ? Response.json({
              flag: 1,
              data: {
                data: [
                  {
                    job: {
                      jobId: 80000001,
                      title,
                      link: url,
                      dq: '成都',
                      salary: '面议',
                      requireEduLevel: '本科',
                    },
                    comp: { compId: 123, compName: company },
                  },
                ],
                addData: [],
                hasNextPage: false,
              },
            })
          : new Response(
              `<script type="application/ld+json">${JSON.stringify({ '@type': 'JobPosting', title, url, identifier: { propertyID: 'liepin.com', value: '80000001' }, hiringOrganization: { name: company, sameAs: 'https://www.liepin.com/company/123/' }, description })}</script>`,
              { headers: { 'content-type': 'text/html' } },
            ),
      );
    },
  });
  const repository = new SqlitePlatformRepository(db.client, 'liepin');
  const connect = vi
    .spyOn(LiepinCdpSessionProvider.prototype, 'connect')
    .mockResolvedValue(session);
  const production = createProductionWorkerApplication({ dataRoot });
  const registry = new HandlerRegistry();
  registry.register(
    createPlatformTaskHandler('liepin', {
      execute: () => Promise.reject(new Error('Publisher only')),
    }),
  );
  const queue = new SqliteTaskRepository(db.client);
  const deps = {
    queue,
    clock: { now: () => utcInstant(Date.now()) },
    ids: new SystemIdGenerator(),
  };
  const tasks = new TaskService(deps, registry);
  const web = new WebPlatformService(repository, tasks, 'liepin');
  /** 通过发布与租约执行，测试不直接写职位表。 */
  const consume = async (command: BossCommand): Promise<void> => {
    const submitted = web.mutate({ command, idempotencyToken: randomUUID() });
    expect(await production.engine.runOnce('platform.liepin')).toBe(true);
    expect(tasks.get(parseId(submitted.taskId, 'Task'))?.status).toBe('succeeded');
  };
  try {
    // 1、仅显式 next 自动补齐正文，保存后无需再次点击收藏或详情。
    const { stdout } = await promisify(execFile)(process.execPath, [
      path.resolve('apps/cli/dist/platform-main.js'),
      '--data-root',
      dataRoot,
      '--provider',
      'liepin',
      'connect',
      '--port-file',
      '/synthetic/DevToolsActivePort',
      '--target-id',
      'fixture',
    ]);
    const submitted = JSON.parse(stdout) as { task: { id: string } };
    expect(await production.engine.runOnce('platform.liepin')).toBe(true);
    expect(tasks.get(parseId(submitted.task.id, 'Task'))?.status).toBe('succeeded');
    expect(connect).toHaveBeenCalledTimes(1);
    await consume({ action: 'next', generation: repository.generation() });
    expect(web.snapshot().batch?.savedCount).toBe(1);
    expect(requests).toBe(2);
    const jobs = new SqliteJobQueryRepository(db.client);
    const queries = new WebJobQueryService(
      new JobQueryService({ jobs, companies: new SqliteCompanyLookupRepository(db.client) }),
    );
    const result = queries.list(
      webJobQuerySchema.parse({ sourceKind: 'platform', providerKey: 'liepin' }),
    );
    expect(result.page.total).toBe(1);
    const first = result.items[0];
    if (!first) throw new Error('Missing job');
    expect(jobs.get(parseId(first.id, 'Job'))?.description).toBe(description);
    // 2、只读本地查询不调用上游，不影响官网或其他平台命名空间。
    expect(queries.list(webJobQuerySchema.parse({})).page.total).toBe(0);
    expect(
      queries.list(webJobQuerySchema.parse({ sourceKind: 'platform', providerKey: 'boss' })).page
        .total,
    ).toBe(0);
    expect(requests).toBe(2);
    expect(db.client.prepare('SELECT count(*) FROM sync_runs').pluck().get()).toBe(0);
    expect(db.client.prepare('SELECT missing_count FROM jobs').pluck().get()).toBe(0);
    expect(db.client.pragma('foreign_key_check')).toEqual([]);
    // 3、认证数据不进入任务、连接、职位、修订或观察记录。
    for (const table of [
      'tasks',
      'platform_connections',
      'jobs',
      'job_revisions',
      'job_observations',
    ])
      expect(JSON.stringify(db.client.prepare(`SELECT * FROM ${table}`).all())).not.toContain(
        'private-liepin-fixture',
      );
  } finally {
    await production.close();
    connect.mockRestore();
    db.close();
    await rm(dataRoot, { recursive: true, force: true });
  }
});
