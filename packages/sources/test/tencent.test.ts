import { readFile } from 'node:fs/promises';
import { parseId } from '@jobhunter/domain';
import {
  SourceError,
  collectDiscovery,
  defineSourceContractSuite,
  type DiscoverContext,
  type SourceHttpClient,
  type SourceHttpRequest,
  type SourceHttpResponse,
} from '@jobhunter/source-core';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  createTencentAdapter,
  tencentDetailResponseSchema,
  tencentListResponseSchema,
  type TencentConfig,
  type TencentDetail,
  type TencentListJob,
} from '../src/index.js';

const companyId = parseId('018f0000-0000-7000-8000-000000000101', 'Company');
const sourceId = parseId('018f0000-0000-7000-8000-000000000201', 'JobSource');
const config: TencentConfig = { language: 'zh-cn', pageSize: 2 };
let listPage1: unknown;
let listPage2: unknown;
let detailResponse: unknown;

async function fixture(name: string): Promise<unknown> {
  const text = await readFile(new URL(`./fixtures/tencent/${name}`, import.meta.url), 'utf8');
  return JSON.parse(text) as unknown;
}

beforeAll(async () => {
  [listPage1, listPage2, detailResponse] = await Promise.all([
    fixture('list-page-1.json'),
    fixture('list-page-2.json'),
    fixture('detail.json'),
  ]);
});

function response<T>(body: T, url: string): SourceHttpResponse<T> {
  return { status: 200, url, headers: new Headers({ 'content-type': 'application/json' }), body };
}

function fixtureHttp(overrides: { readonly secondPage?: unknown } = {}): SourceHttpClient {
  return {
    request<TBody>(request: SourceHttpRequest): Promise<SourceHttpResponse<TBody>> {
      const url = new URL(request.url);
      if (url.pathname.endsWith('/Query')) {
        const page = url.searchParams.get('pageIndex');
        const body = page === '1' ? listPage1 : (overrides.secondPage ?? listPage2);
        return Promise.resolve(response(body as TBody, request.url));
      }
      if (url.pathname.endsWith('/ByPostId')) {
        return Promise.resolve(response(detailResponse as TBody, request.url));
      }
      return Promise.reject(new Error(`Unexpected fixture request: ${url.pathname}`));
    },
  };
}

function context(http: SourceHttpClient = fixtureHttp()): DiscoverContext<TencentConfig> {
  return {
    sourceId,
    companyId,
    requestId: 'tencent-fixture',
    config,
    signal: new AbortController().signal,
    timeoutMs: 1_000,
    http,
    cursor: null,
  };
}

describe('Tencent source adapter contract', () => {
  const adapter = createTencentAdapter();
  const firstRaw = (): TencentListJob | undefined =>
    tencentListResponseSchema.parse(listPage1).Data.Posts[0];
  const detail = (): TencentDetail => tencentDetailResponseSchema.parse(detailResponse).Data;

  it('loads valid checked-in fixtures', () => {
    expect(firstRaw()?.PostId).toBe('2046558434547101696');
    expect(detail().Requirement).toContain('RAG');
  });

  it('passes the common source contract', async () => {
    const raw = firstRaw();
    expect(raw).toBeDefined();
    if (!raw) return;
    const cases = defineSourceContractSuite(createTencentAdapter, {
      context: context(),
      expectedExternalJobIds: ['2046558434547101696', '2046558482223759360', '2046558500000000000'],
      expectedCoverage: 'complete',
      normalizationCases: [
        {
          discovered: {
            externalJobId: raw.PostId,
            sourceUrl: `https://careers.tencent.com/jobdesc.html?postId=${raw.PostId}`,
            raw,
          },
          detail: detail(),
        },
      ],
      fixtureText: JSON.stringify({ listPage1, listPage2, detailResponse }),
    });
    for (const contractCase of cases) await contractCase.run();
  });

  it('fetches a matching detail and builds official stable URLs', async () => {
    const raw = firstRaw();
    expect(raw).toBeDefined();
    if (!raw) return;
    const discovered = {
      externalJobId: raw.PostId,
      sourceUrl: `https://careers.tencent.com/jobdesc.html?postId=${raw.PostId}`,
      raw,
    };
    const fetched = await adapter.fetchDetail?.(discovered, context());
    const normalized = await adapter.normalize(
      { discovered, detail: fetched ?? null },
      { sourceId, companyId, config },
    );
    expect(normalized.job).toMatchObject({
      externalJobId: raw.PostId,
      title: 'AIGC 算法工程师',
      locations: ['深圳'],
      publishedAt: Date.UTC(2026, 7, 19),
    });
    expect(normalized.job.detailUrl).toBe(
      `https://careers.tencent.com/jobdesc.html?postId=${raw.PostId}`,
    );
    expect(normalized.job.applyUrl).toContain('https://careers.tencent.com/resume.html?');
  });

  it('keeps social jobs social when requirements mention interns', async () => {
    const raw = firstRaw();
    expect(raw).toBeDefined();
    if (!raw) return;
    const socialRaw = { ...raw, Responsibility: `${raw.Responsibility}\n指导实习生。` };
    const normalized = await adapter.normalize(
      {
        discovered: {
          externalJobId: socialRaw.PostId,
          sourceUrl: `https://careers.tencent.com/jobdesc.html?postId=${socialRaw.PostId}`,
          raw: socialRaw,
        },
        detail: detail(),
      },
      { sourceId, companyId, config },
    );
    expect(normalized.job).toMatchObject({
      recruitmentCategory: 'social',
      employmentType: '全职',
    });
  });

  it('reports partial when the advertised total cannot be reached', async () => {
    const emptySecond = { Code: 200, Data: { Count: 3, Posts: [] } };
    const discovery = await collectDiscovery(
      adapter.discover(context(fixtureHttp({ secondPage: emptySecond }))),
    );
    expect(discovery.completion).toMatchObject({ coverage: 'partial', discoveredCount: 2 });
  });

  it('preserves access-blocked classification and health diagnostics', async () => {
    const blockedHttp: SourceHttpClient = {
      request: () => Promise.reject(new SourceError('access_blocked', 'Fixture challenge.')),
    };
    await expect(collectDiscovery(adapter.discover(context(blockedHttp)))).rejects.toMatchObject({
      category: 'access_blocked',
    });
    await expect(adapter.healthCheck(context(blockedHttp))).resolves.toMatchObject({
      status: 'unhealthy',
      errorCategory: 'access_blocked',
    });
  });
});
