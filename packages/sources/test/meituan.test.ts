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
  createMeituanAdapter,
  meituanConfigSchema,
  meituanDetailResponseSchema,
  meituanListResponseSchema,
  type MeituanConfig,
  type MeituanDetail,
} from '../src/index.js';

const companyId = parseId('018f0000-0000-7000-8000-000000000106', 'Company');
const sourceId = parseId('018f0000-0000-7000-8000-000000000206', 'JobSource');
const config = meituanConfigSchema.parse({ pageSize: 2 });
let listPage1: unknown;
let listPage2: unknown;
let detailResponse: unknown;

async function fixture(name: string): Promise<unknown> {
  const text = await readFile(new URL(`./fixtures/meituan/${name}`, import.meta.url), 'utf8');
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
      if (url.pathname.endsWith('/getJobList')) {
        const body = JSON.parse(request.body ?? '{}') as { page?: { pageNo?: number } };
        const page = body.page?.pageNo;
        const fixtureBody = page === 1 ? listPage1 : (overrides.secondPage ?? listPage2);
        return Promise.resolve(response(fixtureBody as TBody, request.url));
      }
      if (url.pathname.endsWith('/getJobDetail')) {
        return Promise.resolve(response(detailResponse as TBody, request.url));
      }
      return Promise.reject(new Error(`Unexpected fixture request: ${url.pathname}`));
    },
  };
}

function context(http: SourceHttpClient = fixtureHttp()): DiscoverContext<MeituanConfig> {
  return {
    sourceId,
    companyId,
    requestId: 'meituan-fixture',
    config,
    signal: new AbortController().signal,
    timeoutMs: 1_000,
    http,
    cursor: null,
  };
}

describe('Meituan source adapter contract', () => {
  const adapter = createMeituanAdapter();
  const firstRaw = ():
    ReturnType<typeof meituanListResponseSchema.parse>['data']['list'][number] | undefined =>
    meituanListResponseSchema.parse(listPage1).data.list[0];
  const detail = (): MeituanDetail => meituanDetailResponseSchema.parse(detailResponse).data;

  it('loads valid checked-in fixtures', () => {
    expect(firstRaw()?.jobUnionId).toBe('4702437501');
    expect(detail().jobRequirement).toContain('人工智能');
  });

  it('passes the common source contract', async () => {
    const raw = firstRaw();
    expect(raw).toBeDefined();
    if (!raw) return;
    const cases = defineSourceContractSuite(createMeituanAdapter, {
      context: context(),
      expectedExternalJobIds: ['4702437501', '4604300717', '3517164755'],
      expectedCoverage: 'complete',
      normalizationCases: [
        {
          discovered: {
            externalJobId: raw.jobUnionId,
            sourceUrl: `https://zhaopin.meituan.com/web/position/detail?jobShareType=1&jobUnionId=${raw.jobUnionId}`,
            raw,
          },
          detail: detail(),
        },
      ],
      fixtureText: JSON.stringify({ listPage1, listPage2, detailResponse }),
    });
    for (const contractCase of cases) await contractCase.run();
  });

  it('fetches matching detail and builds official stable URLs', async () => {
    const raw = firstRaw();
    expect(raw).toBeDefined();
    if (!raw) return;
    const discovered = {
      externalJobId: raw.jobUnionId,
      sourceUrl: `https://zhaopin.meituan.com/web/position/detail?jobShareType=1&jobUnionId=${raw.jobUnionId}`,
      raw,
    };
    const fetched = await adapter.fetchDetail?.(discovered, context());
    const normalized = await adapter.normalize(
      { discovered, detail: fetched ?? null },
      { sourceId, companyId, config },
    );
    expect(normalized.job).toMatchObject({
      externalJobId: raw.jobUnionId,
      title: '大模型应用算法工程师（智能客服）',
      locations: ['北京市', '上海市'],
      publishedAt: 1787054202000,
      employmentType: '全职',
    });
    expect(normalized.job.detailUrl).toBe(
      `https://zhaopin.meituan.com/web/position/detail?jobShareType=1&jobUnionId=${raw.jobUnionId}`,
    );
    expect(normalized.job.applyUrl).toBe(
      `https://zhaopin.meituan.com/web/delivery-confirm?jobShareType=1&jobUnionId=${raw.jobUnionId}`,
    );
  });

  it('reports partial when the advertised total cannot be reached', async () => {
    const emptySecond = {
      data: { list: [], page: { pageNo: 2, pageSize: 2, totalPage: 2, totalCount: 3 } },
      status: 1,
      message: '成功',
    };
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
