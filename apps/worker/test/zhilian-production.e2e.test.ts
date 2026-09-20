import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  ZhilianCdpSessionProvider,
  Job51CdpSessionProvider,
  Job51HttpSession,
  ZhilianCampusHttpSession,
  ZhilianSearchHttpSession,
  type ZhilianSearchTemplates,
} from '@jobhunter/platform-connectors';
import {
  openSqliteDatabase,
  SqliteTaskRepository,
  SqlitePlatformRepository,
  SqliteJobQueryRepository,
} from '@jobhunter/db';
import {
  bossResultSchema,
  createPlatformTaskHandler,
  HandlerRegistry,
  TaskService,
  WebPlatformService,
} from '@jobhunter/application';
import { parseId, SystemIdGenerator, utcInstant } from '@jobhunter/domain';
import { createProductionWorkerApplication } from '../src/index.js';

const execute = promisify(execFile);

/** CLI 真子进程、生产装配和隔离 SQLite；只有浏览器借用及上游响应为合成数据。 */
it.each(['campus', 'search', '51job'] as const)(
  'runs Zhilian %s CLI through production Worker, unified jobs and provider-bound Web projection',
  async (mode) => {
    const provider = mode === '51job' ? '51job' : 'zhilian';
    const externalId = mode === '51job' ? '100' : 'CC_TEST';
    const root = { path: await mkdtemp(path.join(tmpdir(), 'zhilian-production-')) };
    const auth = { at: 'fixture-secret-at', rt: 'fixture-secret-rt', d: 'fixture-secret-d' };
    let now = 0;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          statusCode: 200,
          data: {
            isEndPage: 1,
            list: [
              {
                number: 'CC_TEST',
                name: '研发实习生',
                companyNumber: 'KA_TEST',
                companyName: '测试公司',
                workCity: '上海',
                salary60: '面议',
                education: '本科',
                workingExp: '',
              },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          statusCode: 200,
          data: {
            positionDetail: {
              positionNumber: 'CC_TEST',
              positionName: '研发实习生',
              jobDesc: '<p>参与研发。</p><ol><li>编写测试。</li></ol>',
              positionWorkCity: '上海',
              positionWorkingExp: '',
              salary60: '面议',
              education: '本科',
            },
            companyDetail: { companyNumber: 'KA_TEST', companyName: '测试公司' },
          },
        }),
      );
    const search = JSON.parse(
      readFileSync(
        new URL('../../../fixtures/platforms/zhilian-search.json', import.meta.url),
        'utf8',
      ),
    ) as { templates: ZhilianSearchTemplates; row: unknown; detail: unknown };
    if (mode === 'search')
      fetcher
        .mockReset()
        .mockResolvedValueOnce(
          Response.json({
            code: 200,
            apiCode: 200,
            data: {
              statusCode: 200,
              isVerification: 0,
              count: 1,
              isEndPage: 1,
              list: [search.row],
            },
          }),
        )
        .mockResolvedValueOnce(Response.json(search.detail));
    if (mode === '51job')
      fetcher.mockReset().mockResolvedValueOnce(
        Response.json({
          status: '1',
          resultbody: {
            job: {
              totalCount: 1,
              items: [
                {
                  jobId: '100',
                  coId: '200',
                  jobName: '开发工程师',
                  companyName: '测试公司',
                  jobAreaString: '上海',
                  provideSalaryString: '面议',
                  workYearString: '',
                  degreeString: '本科',
                  jobHref: 'https://jobs.51job.com/shanghai/100.html?req=private',
                  jobDescribe: '参与研发并编写测试。',
                },
              ],
            },
          },
        }),
      );
    const job51 = new Job51HttpSession({ fetch: fetcher });
    if (mode === '51job')
      job51.offer({
        url: 'https://we.51job.com/api/job/search-pc?api_key=51job&pageNum=1&pageSize=20',
        headers: { cookie: 'fixture-cookie' },
      });
    const connect = vi
      .spyOn(
        mode === '51job' ? Job51CdpSessionProvider.prototype : ZhilianCdpSessionProvider.prototype,
        'connect',
      )
      .mockImplementation(() =>
        Promise.resolve(
          mode === '51job'
            ? job51
            : mode === 'search'
              ? new ZhilianSearchHttpSession({
                  templates: search.templates,
                  fetch: fetcher,
                  now: () => (now += 5001),
                })
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
                      resumeNumber: 'fixture',
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
                }),
        ),
      );
    const worker = createProductionWorkerApplication({ dataRoot: root.path });
    const db = openSqliteDatabase({ dataRoot: root.path });
    const queue = new SqliteTaskRepository(db.client);
    const registry = new HandlerRegistry();
    for (const key of ['boss', 'zhilian', '51job'] as const)
      registry.register(
        createPlatformTaskHandler(key, {
          execute: () => Promise.reject(new Error('Publisher only')),
        }),
      );
    const tasks = new TaskService(
      { queue, ids: new SystemIdGenerator(), clock: { now: () => utcInstant(Date.now()) } },
      registry,
    );
    const web = new WebPlatformService(
      new SqlitePlatformRepository(db.client, provider),
      tasks,
      provider,
    );
    const boss = new WebPlatformService(new SqlitePlatformRepository(db.client), tasks);
    const cli = (
      args: string[],
      selectedProvider = provider as string,
    ): Promise<{ stdout: string; stderr: string }> =>
      execute(process.execPath, [
        path.resolve(import.meta.dirname, '../../cli/dist/platform-main.js'),
        '--data-root',
        root.path,
        '--provider',
        selectedProvider,
        ...args,
      ]);
    /** 发布和消费同一真实任务，不直接写入业务职位。 */
    const run = async (args: string[]): Promise<ReturnType<typeof bossResultSchema.parse>> => {
      const submitted = JSON.parse((await cli(args)).stdout) as { task: { id: string } };
      expect(await worker.engine.runOnce(`platform.${provider}`)).toBe(true);
      const task = queue.get(parseId(submitted.task.id, 'Task'));
      expect(task?.status).toBe('succeeded');
      expect(
        (JSON.parse((await cli(['result', submitted.task.id])).stdout) as { id: string }).id,
      ).toBe(submitted.task.id);
      await expect(cli(['result', submitted.task.id], 'boss')).rejects.toThrow();
      return bossResultSchema.parse(task?.result);
    };
    try {
      // 1、独立连接与推荐；摘要不提前写成正式职位。
      const beforeBoss = boss.snapshot();
      const { generation } = await run([
        'connect',
        '--port-file',
        '/fixture/DevToolsActivePort',
        '--target-id',
        'fixture',
      ]);
      const batch = await run(['next', '--generation', String(generation)]);
      expect(batch.candidates).toHaveLength(1);
      expect(web.snapshot().batch?.candidates).toHaveLength(1);
      expect(db.client.prepare('SELECT count(*) FROM jobs').pluck().get()).toBe(0);
      // 2、CLI 详情保存后，统一查询和 Web 投影定位同一个正式职位。
      const saved = await run(['detail', externalId, '--generation', String(generation)]);
      if (!saved.jobId) throw new Error('Missing saved job');
      expect(
        new SqliteJobQueryRepository(db.client).get(parseId(saved.jobId, 'Job')),
      ).not.toBeNull();
      expect(web.snapshot().saved[externalId]).toBe(saved.jobId);
      expect(boss.snapshot()).toEqual(beforeBoss);
      expect(connect).toHaveBeenCalledTimes(1);
      expect(fetcher).toHaveBeenCalledTimes(mode === '51job' ? 1 : 2);
      // 3、隔离、凭据与官网生命周期不变量必须同时成立。
      for (const table of [
        'jobs',
        'job_revisions',
        'job_observations',
        'tasks',
        'platform_connections',
      ])
        for (const secret of [
          'fixture-secret',
          'fixture-at',
          'fixture-rt',
          'fixture-resume',
          'fixture-cookie',
        ])
          expect(JSON.stringify(db.client.prepare(`SELECT * FROM ${table}`).all())).not.toContain(
            secret,
          );
      expect(db.client.prepare('SELECT count(*) FROM sync_runs').pluck().get()).toBe(0);
      expect(db.client.prepare('SELECT missing_count FROM jobs').pluck().get()).toBe(0);
      expect(db.client.pragma('foreign_key_check')).toEqual([]);
      await run(['disconnect', '--generation', String(generation)]);
      expect(web.snapshot().connection?.status).toBe('disconnected');
      expect(boss.snapshot()).toEqual(beforeBoss);
      await expect(cli(['next', '--generation', '1'], 'liepin')).rejects.toThrow();
      expect(queue.list({ taskType: 'platform.liepin', limit: 10 })).toHaveLength(0);
    } finally {
      await worker.close();
      db.close();
      connect.mockRestore();
      await rm(root.path, { recursive: true, force: true });
    }
  },
  30_000,
);
