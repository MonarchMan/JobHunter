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
  firstPartySourceCatalog,
  type FirstPartySourceSeed,
} from '@jobhunter/sources';
import { createTemporaryDataRoot } from '@jobhunter/testkit';
import { afterEach, describe, expect, it } from 'vitest';
import {
  openSqliteDatabase,
  seedSourceCatalog,
  SqliteArtifactStore,
  SqliteUnitOfWork,
  type SqliteDatabaseHandle,
} from '../src/index.js';

class FixedClock implements Clock {
  public now(): UtcInstant {
    return utcInstant(1_800_000_000_000);
  }
}

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

async function meituanFixture(name: string): Promise<unknown> {
  const text = await readFile(
    new URL(`../../sources/test/fixtures/meituan/${name}`, import.meta.url),
    'utf8',
  );
  return JSON.parse(text) as unknown;
}

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
  it('seeds all companies idempotently without overriding runtime switches or health', async () => {
    const { handle } = await database();
    seedSourceCatalog(handle.client, firstPartySourceCatalog, { now: 1 });
    handle.client
      .prepare(
        `UPDATE job_sources SET enabled = 0, health_status = 'degraded', consecutive_failures = 2
         WHERE slug = 'tencent-social'`,
      )
      .run();
    seedSourceCatalog(handle.client, firstPartySourceCatalog, { now: 2 });

    expect(handle.client.prepare('SELECT count(*) FROM companies').pluck().get()).toBe(10);
    expect(handle.client.prepare('SELECT count(*) FROM job_sources').pluck().get()).toBe(13);
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
    const { root, handle } = await database();
    seedSourceCatalog(handle.client, firstPartySourceCatalog, { now: 1 });
    const tencent = firstPartySourceCatalog.find(
      (record): record is FirstPartySourceSeed => record.company.slug === 'tencent',
    );
    expect(tencent).toBeDefined();
    if (!tencent) return;

    const registry = new AdapterRegistry();
    registry.register(createTencentAdapter());
    const ids = new SequentialIds();
    const service = new JobSyncService({
      uow: new SqliteUnitOfWork(handle.client),
      registry,
      artifacts: new SqliteArtifactStore(handle.client, root.path),
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
      stats: { discovered: 1, created: 1, followupEnqueued: 0 },
    });
    expect(handle.client.prepare('SELECT title, status FROM jobs').get()).toEqual({
      title: 'Agent 开发工程师',
      status: 'active',
    });
  });

  it('runs the supported Meituan adapter and preserves jobs after a partial page', async () => {
    const { root, handle } = await database();
    seedSourceCatalog(handle.client, firstPartySourceCatalog, { now: 1 });
    const meituan = firstPartySourceCatalog.find(
      (record): record is FirstPartySourceSeed => record.company.slug === 'meituan',
    );
    expect(meituan).toBeDefined();
    if (!meituan) return;

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
        artifacts: new SqliteArtifactStore(handle.client, root.path),
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
