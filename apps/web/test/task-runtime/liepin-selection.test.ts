import { startCentralTaskService, taskServiceConfiguration } from '@jobhunter/common/task-service';
import { loadRuntimeAppConfig } from '@jobhunter/common/config/index';
import { scanTaskProjection } from '@jobhunter/recruitment/persistence/scan-task-sql';
import { SqliteJobScoreReader } from '@jobhunter/matching/persistence/job-score-reader';
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
} from '@jobhunter/recruitment/platform-connectors';
import { createProductionTaskApplication } from '../../src/server/task-runtime.js';
import {
  createPlatformTaskHandler,
  type BossCommand,
} from '@jobhunter/recruitment/platform-application/platforms';
import { HandlerRegistry, TaskService } from '@jobhunter/common/tasks';
import { WebPlatformService } from '@jobhunter/recruitment/platform-application/web-platforms';
import { WebJobQueryService } from '@jobhunter/matching/application/web-job-query-service';
import { JobQueryService } from '@jobhunter/recruitment/jobs/job-query-service';
import { webJobQuerySchema } from '@jobhunter/matching/contracts/web';
import { openSqliteDatabase } from '@jobhunter/common/persistence/connection';
import { SqlitePlatformRepository } from '@jobhunter/recruitment/persistence/platform-repository';
import { SqliteTaskRepository } from '@jobhunter/common/persistence/tasks';
import {
  SqliteJobQueryRepository,
  SqliteCompanyLookupRepository,
} from '@jobhunter/recruitment/persistence/job-query-repository';
import { SystemIdGenerator, utcInstant, parseId } from '@jobhunter/common/domain';

/** 子进程不继承 Vitest 注入的相对 BASE_URL，确保 CLI 使用完整的模型默认地址。 */
async function execute(
  file: string,
  args: readonly string[],
): Promise<{ stdout: string; stderr: string }> {
  const environment = { ...process.env, BASE_URL: '' };
  const config = await loadRuntimeAppConfig({
    cli: { dataRoot: args[args.indexOf('--data-root') + 1] },
    environment,
    workspaceRoot: path.resolve(import.meta.dirname, '../../../..'),
  });
  // 命令契约使用真实 IPC 但不消费任务；下面的生产处理器测试显式装配合成依赖。
  // 合成宿主没有生产装配步骤，需在持有服务锁之前初始化测试库。
  openSqliteDatabase({ dataRoot: config.bootstrap.dataRoot.value }).close();
  const service = await startCentralTaskService({
    dataRoot: config.bootstrap.dataRoot.value,
    configuration: taskServiceConfiguration(config),
    createRuntime: () => ({
      run: (signal) =>
        new Promise<void>((resolve) => {
          signal.addEventListener(
            'abort',
            () => {
              resolve();
            },
            { once: true },
          );
        }),
      request: () => null,
      close: () => Promise.resolve(),
    }),
  });
  try {
    return await promisify(execFile)(file, [...args], { env: environment });
  } finally {
    await service?.close();
  }
}

/** 上游采用合成协议，真实 Worker／隔离 SQLite／职位页查询覆盖正式生命周期。 */
it('猎聘 HTTP 批次自动入库，官网和其他平台查询保持隔离', async () => {
  const dataRoot = await mkdtemp(path.join(tmpdir(), 'liepin-flow-'));
  const portFile = path.join(dataRoot, 'DevToolsActivePort');
  // 1、CLI 使用宿主平台临时绝对路径，并在进程内连接 SQLite 前完成任务发布。
  const { stdout } = await execute(process.execPath, [
    path.resolve('apps/cli/dist/platform-main.js'),
    '--data-root',
    dataRoot,
    '--provider',
    'liepin',
    'connect',
    '--port-file',
    portFile,
    '--target-id',
    'fixture',
  ]);
  const submitted = JSON.parse(stdout) as { task: { id: string } };
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
  const production = createProductionTaskApplication({ dataRoot });
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
    expect(await production.engine.runOnce('platform.liepin')).toBe(true);
    expect(tasks.get(parseId(submitted.task.id, 'Task'))?.status).toBe('succeeded');
    expect(connect).toHaveBeenCalledTimes(1);
    await consume({ action: 'next', generation: repository.generation() });
    expect(web.snapshot().batch?.savedCount).toBe(1);
    expect(requests).toBe(2);
    const jobs = new SqliteJobQueryRepository(db.client, new SqliteJobScoreReader(db.client));
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
    expect(db.client.prepare(`SELECT count(*) FROM ${scanTaskProjection}`).pluck().get()).toBe(0);
    expect(db.client.prepare('SELECT missing_count FROM jobs').pluck().get()).toBe(0);
    expect(db.client.pragma('foreign_key_check')).toEqual([]);
    // 3、认证数据不进入任务、连接、职位、修订或观察记录。
    for (const table of ['tasks', 'platform_connections', 'jobs', 'jobs', 'job_observations'])
      expect(JSON.stringify(db.client.prepare(`SELECT * FROM ${table}`).all())).not.toContain(
        'private-liepin-fixture',
      );
  } finally {
    await production.close();
    connect.mockRestore();
    db.close();
    await rm(dataRoot, { recursive: true, force: true });
  }
}, 20_000);
