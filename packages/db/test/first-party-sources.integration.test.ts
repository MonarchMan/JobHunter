import { DefaultDerivationTaskFactory, JobSyncService } from '@jobhunter/application';
import { parseId, utcInstant, type Clock, type UtcInstant } from '@jobhunter/domain';
import {
  AdapterRegistry,
  type SourceHttpClient,
  type SourceHttpRequest,
  type SourceHttpResponse,
} from '@jobhunter/source-core';
import {
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
    expect(handle.client.prepare('SELECT count(*) FROM job_sources').pluck().get()).toBe(10);
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
      derivationTasks: new DefaultDerivationTaskFactory(ids, 'enrich-v1'),
      options: { normalizerVersion: 'normalize-v1' },
    });
    const sourceId = parseId(tencent.source.id, 'JobSource');

    await expect(
      service.run({ sourceId, trigger: 'manual' }, new AbortController().signal),
    ).resolves.toMatchObject({
      kind: 'completed',
      status: 'succeeded',
      coverage: 'complete',
      stats: { discovered: 1, created: 1, followupEnqueued: 2 },
    });
    expect(handle.client.prepare('SELECT title, status FROM jobs').get()).toEqual({
      title: 'Agent 开发工程师',
      status: 'active',
    });
  });
});
