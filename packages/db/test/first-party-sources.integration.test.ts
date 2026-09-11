import { readFile } from 'node:fs/promises';
import { JobSyncService } from '@jobhunter/application';
import { parseId, utcInstant, type Clock, type UtcInstant } from '@jobhunter/domain';
import {
  AdapterRegistry,
  type SourceHttpClient,
  type SourceHttpRequest,
  type SourceHttpResponse,
} from '@jobhunter/source-core';
import {
  createMeituanAdapter,
  createTencentAdapter,
  createKuaishouAdapter,
  createDidiAdapter,
  createCtripAdapter,
  createMihoyoAdapter,
  mihoyoSites,
  ctripSites,
  didiSites,
  parseDidiPage,
  kuaishouSite,
  type KuaishouKey,
  firstPartyPhysicalSourceCatalog,
  firstPartySourceCatalog,
} from '@jobhunter/sources';
import { createTemporaryDataRoot } from '@jobhunter/testkit';
import { afterEach, describe, expect, it } from 'vitest';
import {
  openSqliteDatabase,
  seedSourceCatalog,
  SqliteUnitOfWork,
  SqliteWebSourceRepository,
  type SqliteDatabaseHandle,
} from '../src/index.js';

/** 构造测试输入或执行断言的辅助逻辑。 */
class FixedClock implements Clock {
  public now(): UtcInstant {
    return utcInstant(1_800_000_000_000);
  }
}

/** 构造测试输入或执行断言的辅助逻辑。 */
class SequentialIds {
  #counter = 0x5000;

  public generate(): string {
    const suffix = this.#counter.toString(16).padStart(12, '0');
    this.#counter += 1;
    return `018f0000-0000-7000-8000-${suffix}`;
  }
}

const resources: {
  readonly root: Awaited<ReturnType<typeof createTemporaryDataRoot>>;
  readonly handle: SqliteDatabaseHandle;
}[] = [];

afterEach(async () => {
  for (const resource of resources.splice(0)) {
    resource.handle.close();
    await resource.root.cleanup();
  }
});

/** 构造测试输入或执行断言的辅助逻辑。 */
async function database(): Promise<{
  readonly root: Awaited<ReturnType<typeof createTemporaryDataRoot>>;
  readonly handle: SqliteDatabaseHandle;
}> {
  const root = await createTemporaryDataRoot('jobhunter-first-party-');
  const handle = openSqliteDatabase({ dataRoot: root.path });
  resources.push({ root, handle });
  return { root, handle };
}

const listJob = {
  PostId: '2046558434547101696',
  RecruitPostName: 'Agent 开发工程师',
  CountryName: '中国',
  LocationName: '深圳',
  BGName: 'WXG',
  ComCode: '',
  ComName: '',
  ProductName: 'AI 平台',
  CategoryName: '技术',
  Responsibility: '负责 Agent 系统研发。',
  LastUpdateTime: '2026年08月19日',
  PostURL: 'http://careers.tencent.com/jobdesc.html?postId=2046558434547101696',
  SourceID: 1,
  IsValid: true,
  RequireWorkYearsName: '两年以上工作经验',
};

const detailJob = {
  ...listJob,
  OuterPostTypeID: '40002002',
  Requirement: '熟悉 TypeScript、RAG 与多 Agent 系统。',
  DepartmentIntroduction: '负责大模型应用平台。',
};

function response<T>(body: T, url: string): SourceHttpResponse<T> {
  return { status: 200, url, headers: new Headers(), body };
}

const fixtureHttp: SourceHttpClient = {
  request<TBody>(request: SourceHttpRequest): Promise<SourceHttpResponse<TBody>> {
    const url = new URL(request.url);
    const body = url.pathname.endsWith('/Query')
      ? { Code: 200, Data: { Count: 1, Posts: [listJob] } }
      : { Code: 200, Data: detailJob };
    return Promise.resolve(response(body as TBody, request.url));
  },
};

/** 构造测试输入或执行断言的辅助逻辑。 */
async function meituanFixture(name: string): Promise<unknown> {
  const text = await readFile(
    new URL(`../../sources/test/fixtures/meituan/${name}`, import.meta.url),
    'utf8',
  );
  return JSON.parse(text) as unknown;
}

/** 构造测试输入或执行断言的辅助逻辑。 */
function meituanSyncHttp(input: {
  readonly listJob: unknown;
  readonly detail: unknown;
  readonly partial: boolean;
}): SourceHttpClient {
  return {
    request<TBody>(request: SourceHttpRequest): Promise<SourceHttpResponse<TBody>> {
      const url = new URL(request.url);
      if (url.pathname.endsWith('/getJobList')) {
        const body = JSON.parse(request.body ?? '{}') as { page?: { pageNo?: number } };
        const pageNo = body.page?.pageNo ?? 1;
        if (pageNo === 2 && input.partial) {
          return Promise.resolve(
            response(
              {
                data: {
                  list: [],
                  page: { pageNo: 2, pageSize: 1, totalPage: 2, totalCount: 2 },
                },
                status: 1,
                message: '成功',
              } as TBody,
              request.url,
            ),
          );
        }
        return Promise.resolve(
          response(
            {
              data: {
                list: [input.listJob],
                page: {
                  pageNo: 1,
                  pageSize: 1,
                  totalPage: input.partial ? 2 : 1,
                  totalCount: input.partial ? 2 : 1,
                },
              },
              status: 1,
              message: '成功',
            } as TBody,
            request.url,
          ),
        );
      }
      if (url.pathname.endsWith('/getJobDetail')) {
        return Promise.resolve(response(input.detail as TBody, request.url));
      }
      return Promise.reject(new Error(`Unexpected Meituan fixture request: ${url.pathname}`));
    },
  };
}

describe('first-party source seed and sync', () => {
  it.each(['mihoyo.social', 'mihoyo.intern', 'mihoyo.campus'] as const)(
    '%s requires real detail before persistence and protects missing state (SWT-019)',
    async (key) => {
      // 1、独立临时 SQLite 验证 required 详情失败不会创建占位岗位。
      const { handle } = await database();
      seedSourceCatalog(handle.client, firstPartySourceCatalog, { now: 1 });
      const source = firstPartyPhysicalSourceCatalog.find((v) => v.source.adapterKey === key);
      if (!source) throw new Error('Missing Mihoyo source.');
      handle.client
        .prepare('UPDATE source_channels SET enabled = 1 WHERE id = ?')
        .run(source.channel.id);
      const fixture = JSON.parse(
        await readFile(
          new URL('../../sources/test/fixtures/mihoyo/jobs.json', import.meta.url),
          'utf8',
        ),
      ) as Record<string, { id: string }>;
      const job = fixture[mihoyoSites[key].channel];
      if (!job) throw new Error('Missing Mihoyo fixture.');
      const registry = new AdapterRegistry();
      registry.register(createMihoyoAdapter(key));
      let detailFailure = true;
      let partial = false;
      const service = new JobSyncService({
        uow: new SqliteUnitOfWork(handle.client),
        registry,
        http: {
          request: (request) => {
            if (request.url.endsWith('/info') && detailFailure)
              return Promise.reject(new Error('Synthetic detail failure'));
            return Promise.resolve(
              response(
                {
                  code: 0,
                  success: true,
                  data: request.url.endsWith('/info')
                    ? job
                    : { total: 1, pageNo: 1, pageSize: 10, list: partial ? [] : [job] },
                } as never,
                request.url,
              ),
            );
          },
        },
        clock: new FixedClock(),
        ids: new SequentialIds(),
        options: { normalizerVersion: 'normalize-v1' },
      });
      const sourceId = parseId(source.source.id, 'JobSource');
      await service.run({ sourceId, trigger: 'manual' }, new AbortController().signal);
      expect(handle.client.prepare('SELECT count(*) FROM jobs').pluck().get()).toBe(0);
      // 2、取得真实详情后才能入库；后续缺页保持 partial，不增加缺失计数。
      detailFailure = false;
      await expect(
        service.run({ sourceId, trigger: 'manual' }, new AbortController().signal),
      ).resolves.toMatchObject({ kind: 'completed', status: 'succeeded', stats: { created: 1 } });
      partial = true;
      await expect(
        service.run({ sourceId, trigger: 'manual' }, new AbortController().signal),
      ).resolves.toMatchObject({ kind: 'completed', status: 'partial', coverage: 'partial' });
      expect(
        handle.client
          .prepare('SELECT source_id, external_job_id, status, missing_count FROM jobs')
          .get(),
      ).toEqual({
        source_id: source.source.id,
        external_job_id: job.id,
        status: 'active',
        missing_count: 0,
      });
    },
  );
  it.each(['ctrip.social', 'ctrip.intern', 'ctrip.campus'] as const)(
    '%s persists inline jobs and protects missing state on short pages (SWT-018)',
    async (key) => {
      // 1、真实 SQLite 配合合成官网 HTTP；每个分区独立验证生产同步，无网络。
      const { handle } = await database();
      seedSourceCatalog(handle.client, firstPartySourceCatalog, { now: 1 });
      const source = firstPartyPhysicalSourceCatalog.find((v) => v.source.adapterKey === key);
      if (!source) throw new Error('Missing Ctrip source.');
      handle.client
        .prepare('UPDATE source_channels SET enabled = 1 WHERE id = ?')
        .run(source.channel.id);
      const fixture = JSON.parse(
        await readFile(
          new URL('../../sources/test/fixtures/ctrip/jobs.json', import.meta.url),
          'utf8',
        ),
      ) as Record<string, { fromId: string }>;
      const job = fixture[ctripSites[key].channel];
      if (!job) throw new Error('Missing Ctrip fixture.');
      const registry = new AdapterRegistry();
      registry.register(createCtripAdapter(key));
      let partial = false;
      const service = new JobSyncService({
        uow: new SqliteUnitOfWork(handle.client),
        registry,
        http: {
          request: (request) =>
            Promise.resolve(
              response(
                {
                  retCode: '201',
                  retValue: { total: 1, recruitJobAdList: partial ? [] : [job] },
                } as never,
                request.url,
              ),
            ),
        },
        clock: new FixedClock(),
        ids: new SequentialIds(),
        options: { normalizerVersion: 'normalize-v1' },
      });
      const sourceId = parseId(source.source.id, 'JobSource');
      await expect(
        service.run({ sourceId, trigger: 'manual' }, new AbortController().signal),
      ).resolves.toMatchObject({
        kind: 'completed',
        status: 'succeeded',
        coverage: 'complete',
        stats: { created: 1 },
      });
      // 2、缺页仍报告 partial，不增加旧岗位 missing_count，也不创建占位正文。
      partial = true;
      await expect(
        service.run({ sourceId, trigger: 'manual' }, new AbortController().signal),
      ).resolves.toMatchObject({ kind: 'completed', status: 'partial', coverage: 'partial' });
      expect(
        handle.client
          .prepare('SELECT source_id, external_job_id, status, missing_count FROM jobs')
          .get(),
      ).toEqual({
        source_id: source.source.id,
        external_job_id: job.fromId,
        status: 'active',
        missing_count: 0,
      });
    },
  );
  it.each([
    'kuaishou.social',
    'kuaishou.intern',
    'kuaishou.intern.campus',
    'kuaishou.campus',
  ] as const)(
    '%s persists through production sync and does not mark jobs missing after a partial result',
    async (key: KuaishouKey) => {
      // 1、真实 SQLite/目录/应用同步配合合成浏览器结果，禁止在线访问。
      const { handle } = await database();
      seedSourceCatalog(handle.client, firstPartySourceCatalog, { now: 1 });
      const source = firstPartyPhysicalSourceCatalog.find(
        (record) => record.source.adapterKey === key,
      );
      if (!source) throw new Error('Missing Kuaishou physical source.');
      handle.client
        .prepare('UPDATE source_channels SET enabled = 1 WHERE id = ?')
        .run(source.channel.id);
      const registry = new AdapterRegistry();
      registry.register(createKuaishouAdapter(key));
      const site = kuaishouSite(key);
      let partial = false;
      const service = new JobSyncService({
        uow: new SqliteUnitOfWork(handle.client),
        registry,
        http: { request: () => Promise.reject(new Error('No online HTTP.')) },
        clock: new FixedClock(),
        ids: new SequentialIds(),
        options: { normalizerVersion: 'normalize-v1' },
        page: {
          snapshot: () => Promise.reject(new Error('No online navigation.')),
          collect: () =>
            Promise.resolve({
              coverage: partial ? 'partial' : 'complete',
              pages: [
                {
                  page: 1,
                  url: site.entry,
                  total: 1,
                  capturedAt: 0,
                  records: partial
                    ? []
                    : [
                        {
                          id: '900000001',
                          name: '测试岗位',
                          description: '测试职责',
                          positionDemand: '测试要求',
                          positionNatureCode: site.nature,
                          recruitProjectCode: site.campus ? 'schoolr' : 'socialr',
                          ...(site.campus
                            ? { recruitSubProjectCode: 'synthetic-current-project' }
                            : {}),
                          locations: ['北京'],
                          experienceText: null,
                          categoryName: null,
                        },
                      ],
                },
              ],
            }),
        },
      });
      const sourceId = parseId(source.source.id, 'JobSource');
      await expect(
        service.run({ sourceId, trigger: 'manual' }, new AbortController().signal),
      ).resolves.toMatchObject({
        kind: 'completed',
        status: 'succeeded',
        coverage: 'complete',
        stats: { created: 1 },
      });
      // 2、第二次缺页不能下线既有岗位，各物理来源自己的状态独立保存。
      partial = true;
      await expect(
        service.run({ sourceId, trigger: 'manual' }, new AbortController().signal),
      ).resolves.toMatchObject({ kind: 'completed', status: 'partial', coverage: 'partial' });
      expect(
        handle.client
          .prepare('SELECT source_id, external_job_id, status, missing_count FROM jobs')
          .get(),
      ).toEqual({
        source_id: source.source.id,
        external_job_id: '900000001',
        status: 'active',
        missing_count: 0,
      });
    },
  );

  it.each(['didi.social', 'didi.intern', 'didi.campus', 'didi.campus.elite'] as const)(
    '%s persists inline/required bodies and protects existing jobs on partial sync (SWT-014, SWT-016)',
    async (key) => {
      // 1、独立临时数据库验证生产同步链，实验来源仅在测试内显式启用。
      const { handle } = await database();
      seedSourceCatalog(handle.client, firstPartySourceCatalog, { now: 1 });
      const source = firstPartyPhysicalSourceCatalog.find((v) => v.source.adapterKey === key);
      if (!source) throw new Error('Missing Didi source.');
      handle.client
        .prepare('UPDATE source_channels SET enabled = 1 WHERE id = ?')
        .run(source.channel.id);
      handle.client
        .prepare('UPDATE job_sources SET enabled = 1 WHERE id = ?')
        .run(source.source.id);
      const fixture = JSON.parse(
        await readFile(
          new URL('../../sources/test/fixtures/didi/jobs.json', import.meta.url),
          'utf8',
        ),
      ) as {
        socialList: unknown;
        socialDetail: unknown;
        intern: Record<string, unknown>;
        campus: Record<string, unknown>;
      };
      const job = parseDidiPage(
        key === 'didi.social'
          ? fixture.socialList
          : {
              jobStats: { orgId: 'didiglobal', total: 1 },
              jobs: [key === 'didi.intern' ? fixture.intern : fixture.campus],
            },
        key,
      ).records[0];
      if (!job) throw new Error('Missing Didi fixture.');
      const registry = new AdapterRegistry();
      registry.register(createDidiAdapter(key));
      let partial = false;
      let detailFailure = false;
      const service = new JobSyncService({
        uow: new SqliteUnitOfWork(handle.client),
        registry,
        clock: new FixedClock(),
        ids: new SequentialIds(),
        options: { normalizerVersion: 'normalize-v1' },
        http: {
          request<TBody>(request: SourceHttpRequest): Promise<SourceHttpResponse<TBody>> {
            if (detailFailure && request.url.includes('/view/'))
              return Promise.reject(new Error('Synthetic detail failure.'));
            const body = request.url.includes('/view/')
              ? fixture.socialDetail
              : partial
                ? { meta: { code: 0 }, data: { total: 1, page: 1, size: 16, items: [] } }
                : fixture.socialList;
            return Promise.resolve(response(body as TBody, request.url));
          },
        },
        page: {
          snapshot: () => Promise.reject(new Error('No network.')),
          collect: (request) => {
            if (detailFailure && request.responseShape === 'didi-moka-detail')
              return Promise.reject(new Error('Synthetic detail failure.'));
            return Promise.resolve({
              coverage: partial ? 'partial' : 'complete',
              pages: [
                {
                  page: 1,
                  url: didiSites[key].entry,
                  total: 1,
                  capturedAt: 0,
                  records: partial
                    ? []
                    : [
                        request.responseShape === 'didi-moka-detail'
                          ? // 合成详情提供国内地点；真实空地点仍由既有区域策略跳过，不猜测城市。
                            { ...job, locations: ['北京市'], description: '合成测试职责与要求' }
                          : job,
                      ],
                },
              ],
            });
          },
        },
      });
      const sourceId = parseId(source.source.id, 'JobSource');
      // required 详情失败必须隔离，不能产生岗位或延迟补充任务。
      if (key === 'didi.social' || key === 'didi.intern') {
        detailFailure = true;
        await expect(
          service.run({ sourceId, trigger: 'manual' }, new AbortController().signal),
        ).resolves.toMatchObject({
          kind: 'completed',
          stats: { created: 0, isolated: 1, followupEnqueued: 0 },
        });
        expect(handle.client.prepare('SELECT count(*) FROM jobs').pluck().get()).toBe(0);
        detailFailure = false;
      }
      await expect(
        service.run({ sourceId, trigger: 'manual' }, new AbortController().signal),
      ).resolves.toMatchObject({
        kind: 'completed',
        status: 'succeeded',
        coverage: 'complete',
        stats: { created: 1 },
      });
      // 2、尾页/计数异常保留 partial，不能把旧岗位下线。
      partial = true;
      await expect(
        service.run({ sourceId, trigger: 'manual' }, new AbortController().signal),
      ).resolves.toMatchObject({ kind: 'completed', status: 'partial', coverage: 'partial' });
      expect(
        handle.client
          .prepare('SELECT source_id, external_job_id, status, missing_count FROM jobs')
          .get(),
      ).toEqual({
        source_id: source.source.id,
        external_job_id: job.id,
        status: 'active',
        missing_count: 0,
      });
    },
  );

  it('seeds all companies idempotently without overriding runtime switches or health', async () => {
    const { handle } = await database();
    seedSourceCatalog(handle.client, firstPartySourceCatalog, { now: 1 });
    handle.client
      .prepare(
        `UPDATE job_sources SET enabled = 0, health_status = 'degraded', consecutive_failures = 2
         WHERE slug = 'tencent-social'`,
      )
      .run();
    // 模拟旧目录把精英列为 required；重新 seed 更新角色但不更换身份或重置开关。
    handle.client
      .prepare("UPDATE job_sources SET coverage_role = 'required' WHERE slug = 'didi-campus-elite'")
      .run();
    seedSourceCatalog(handle.client, firstPartySourceCatalog, { now: 2 });

    expect(handle.client.prepare('SELECT count(*) FROM companies').pluck().get()).toBe(20);
    expect(handle.client.prepare('SELECT count(*) FROM source_channels').pluck().get()).toBe(60);
    expect(handle.client.prepare('SELECT count(*) FROM job_sources').pluck().get()).toBe(62);
    expect(
      handle.client
        .prepare('SELECT support_status, enabled FROM job_sources WHERE slug = ?')
        .get('bilibili-social'),
    ).toEqual({ support_status: 'supported', enabled: 1 });
    const webChannels = new SqliteWebSourceRepository(handle.client).listChannels();
    expect(
      handle.client
        .prepare(
          "SELECT id, coverage_role, enabled FROM job_sources WHERE slug = 'didi-campus-elite'",
        )
        .get(),
    ).toEqual({
      id: '018f0000-0000-7000-8000-000000000257',
      coverage_role: 'supplemental',
      enabled: 0,
    });
    expect(
      Object.fromEntries(
        webChannels
          .filter((channel) => channel.companyId === '018f0000-0000-7000-8000-000000000118')
          .map((channel) => [channel.channel, channel.supportStatus]),
      ),
    ).toEqual({ intern: 'supported', campus: 'supported', social: 'supported' });
    expect(
      handle.client
        .prepare(
          "SELECT slug, enabled FROM job_sources WHERE adapter_key LIKE 'didi.%' ORDER BY slug",
        )
        .all(),
    ).toEqual([
      { slug: 'didi-campus', enabled: 1 },
      { slug: 'didi-campus-elite', enabled: 0 },
      { slug: 'didi-intern', enabled: 1 },
      { slug: 'didi-social', enabled: 1 },
    ]);
    expect(
      webChannels
        .filter((channel) => channel.companyId === '018f0000-0000-7000-8000-000000000116')
        .map((channel) => channel.supportStatus),
    ).toEqual(['supported', 'supported', 'supported']);
    const channelsByCompany = new Map<string, string[]>();
    for (const channel of webChannels) {
      const channels = channelsByCompany.get(channel.companyId) ?? [];
      channels.push(channel.channel);
      channelsByCompany.set(channel.companyId, channels);
    }
    expect(channelsByCompany.size).toBe(20);
    for (const channels of channelsByCompany.values()) {
      expect(channels.sort()).toEqual(['campus', 'intern', 'social']);
    }
    expect(
      handle.client
        .prepare(
          `SELECT enabled, support_status, health_status, consecutive_failures
           FROM job_sources WHERE slug = 'tencent-social'`,
        )
        .get(),
    ).toEqual({
      enabled: 0,
      support_status: 'supported',
      health_status: 'degraded',
      consecutive_failures: 2,
    });
  });

  it('runs the supported Tencent adapter through the real sync pipeline', async () => {
    const { handle } = await database();
    seedSourceCatalog(handle.client, firstPartySourceCatalog, { now: 1 });
    const tencent = firstPartyPhysicalSourceCatalog.find(
      (record) => record.company.slug === 'tencent',
    );
    expect(tencent).toBeDefined();
    if (!tencent) return;
    handle.client
      .prepare(
        `UPDATE source_channels SET enabled = 1
         WHERE id = (SELECT channel_id FROM job_sources WHERE id = ?)`,
      )
      .run(tencent.source.id);
    handle.client.prepare('UPDATE job_sources SET enabled = 1 WHERE id = ?').run(tencent.source.id);

    const registry = new AdapterRegistry();
    registry.register(createTencentAdapter());
    const ids = new SequentialIds();
    const service = new JobSyncService({
      uow: new SqliteUnitOfWork(handle.client),
      registry,
      http: fixtureHttp,
      clock: new FixedClock(),
      ids,
      options: { normalizerVersion: 'normalize-v1' },
    });
    const sourceId = parseId(tencent.source.id, 'JobSource');

    await expect(
      service.run({ sourceId, trigger: 'manual' }, new AbortController().signal),
    ).resolves.toMatchObject({
      kind: 'completed',
      status: 'succeeded',
      coverage: 'complete',
      stats: { discovered: 1, created: 1, followupEnqueued: 1 },
    });
    expect(handle.client.prepare('SELECT title, status FROM jobs').get()).toEqual({
      title: 'Agent 开发工程师',
      status: 'active',
    });
  });

  it('keeps identity and missing state isolated between sibling physical sources', async () => {
    const { handle } = await database();
    seedSourceCatalog(handle.client, firstPartySourceCatalog, { now: 1 });
    const companyId = '018f0000-0000-7000-8000-000000000115';
    const sourceIds = [
      '018f0000-0000-7000-8000-000000000245',
      '018f0000-0000-7000-8000-000000000246',
    ] as const;
    const insert = handle.client.prepare(
      `INSERT INTO jobs
       (id, company_id, source_id, external_job_id, title, locations_json, description,
        detail_url, apply_url, status, missing_count, content_hash,
        first_seen_at, last_seen_at, created_at, updated_at)
       VALUES (?, ?, ?, 'same-official-id', '同一岗位', '[]', '职位描述',
               'https://example.com/job', 'https://example.com/apply', 'active', 0, ?, 1, 1, 1, 1)`,
    );
    insert.run('018f0000-0000-7000-8000-000000000601', companyId, sourceIds[0], 'hash-a');
    insert.run('018f0000-0000-7000-8000-000000000602', companyId, sourceIds[1], 'hash-b');

    expect(
      handle.client
        .prepare("SELECT count(*) FROM jobs WHERE external_job_id = 'same-official-id'")
        .pluck()
        .get(),
    ).toBe(2);
    handle.client
      .prepare('UPDATE jobs SET missing_count = 1 WHERE source_id = ?')
      .run(sourceIds[0]);
    expect(
      handle.client.prepare('SELECT source_id, missing_count FROM jobs ORDER BY source_id').all(),
    ).toEqual([
      { source_id: sourceIds[0], missing_count: 1 },
      { source_id: sourceIds[1], missing_count: 0 },
    ]);
  });

  it('runs the supported Meituan adapter and preserves jobs after a partial page', async () => {
    const { handle } = await database();
    seedSourceCatalog(handle.client, firstPartySourceCatalog, { now: 1 });
    const meituan = firstPartyPhysicalSourceCatalog.find(
      (record) => record.company.slug === 'meituan',
    );
    expect(meituan).toBeDefined();
    if (!meituan) return;
    handle.client
      .prepare(
        `UPDATE source_channels SET enabled = 1
         WHERE id = (SELECT channel_id FROM job_sources WHERE id = ?)`,
      )
      .run(meituan.source.id);
    handle.client.prepare('UPDATE job_sources SET enabled = 1 WHERE id = ?').run(meituan.source.id);

    const [listPage, detail] = await Promise.all([
      meituanFixture('list-page-1.json'),
      meituanFixture('detail.json'),
    ]);
    const listJob = (listPage as { data: { list: readonly unknown[] } }).data.list[0];
    expect(listJob).toBeDefined();
    if (!listJob) return;

    const ids = new SequentialIds();
    const createService = (partial: boolean): JobSyncService => {
      const registry = new AdapterRegistry();
      registry.register(createMeituanAdapter());
      return new JobSyncService({
        uow: new SqliteUnitOfWork(handle.client),
        registry,
        http: meituanSyncHttp({ listJob, detail, partial }),
        clock: new FixedClock(),
        ids,
        options: { normalizerVersion: 'normalize-v1' },
      });
    };
    const sourceId = parseId(meituan.source.id, 'JobSource');

    await expect(
      createService(false).run({ sourceId, trigger: 'manual' }, new AbortController().signal),
    ).resolves.toMatchObject({
      kind: 'completed',
      status: 'succeeded',
      coverage: 'complete',
      stats: { discovered: 1, created: 1 },
    });
    await expect(
      createService(true).run({ sourceId, trigger: 'manual' }, new AbortController().signal),
    ).resolves.toMatchObject({
      kind: 'completed',
      status: 'partial',
      coverage: 'partial',
      stats: { discovered: 1, unchanged: 1 },
    });
    expect(
      handle.client.prepare("SELECT count(*) FROM jobs WHERE status = 'active'").pluck().get(),
    ).toBe(1);
  });
});
