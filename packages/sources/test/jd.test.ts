import { readFile } from 'node:fs/promises';
import { parseId } from '@jobhunter/domain';
import {
  SourceError,
  canonicalizeOfficialUrl,
  collectDiscovery,
  defineSourceContractSuite,
  type DiscoverContext,
  type SourceHttpClient,
  type SourceHttpRequest,
  type SourceHttpResponse,
} from '@jobhunter/source-core';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  createJdAdapter,
  jdConfigSchema,
  jdListResponseSchema,
  type JdConfig,
  type JdJob,
} from '../src/index.js';

const companyId = parseId('018f0000-0000-7000-8000-000000000109', 'Company');
const sourceId = parseId('018f0000-0000-7000-8000-000000000209', 'JobSource');
const config = jdConfigSchema.parse({ pageSize: 2 });
let listPage1: unknown;
let listPage2: unknown;

async function fixture(name: string): Promise<unknown> {
  const text = await readFile(new URL(`./fixtures/jd/${name}`, import.meta.url), 'utf8');
  return JSON.parse(text) as unknown;
}

beforeAll(async () => {
  [listPage1, listPage2] = await Promise.all([
    fixture('list-page-1.json'),
    fixture('list-page-2.json'),
  ]);
});

function response<T>(body: T, url: string): SourceHttpResponse<T> {
  return { status: 200, url, headers: new Headers({ 'content-type': 'text/plain' }), body };
}

function fixtureHttp(overrides: { readonly secondPage?: unknown } = {}): SourceHttpClient {
  return {
    request<TBody>(request: SourceHttpRequest): Promise<SourceHttpResponse<TBody>> {
      const url = new URL(request.url);
      if (url.pathname.endsWith('/job_count'))
        return Promise.resolve(response('3' as TBody, request.url));
      if (url.pathname.endsWith('/job_list')) {
        const body = new URLSearchParams(request.body ?? '');
        const page = body.get('pageIndex');
        const pageBody = page === '1' ? listPage1 : (overrides.secondPage ?? listPage2);
        return Promise.resolve(response(JSON.stringify(pageBody) as TBody, request.url));
      }
      return Promise.reject(new Error(`Unexpected fixture request: ${url.pathname}`));
    },
  };
}

function context(http: SourceHttpClient = fixtureHttp()): DiscoverContext<JdConfig> {
  return {
    sourceId,
    companyId,
    requestId: 'jd-fixture',
    config,
    signal: new AbortController().signal,
    timeoutMs: 1_000,
    http,
    cursor: null,
  };
}

describe('JD source adapter contract', () => {
  const adapter = createJdAdapter();
  const firstRaw = (): JdJob | undefined => jdListResponseSchema.parse(listPage1)[0];

  it('loads valid checked-in fixtures and normalizes jsessionid URLs', () => {
    expect(firstRaw()?.requirementId).toBe(221794);
    expect(
      canonicalizeOfficialUrl(
        'https://zhaopin.jd.com/web/job/job_info_list/3;jsessionid=fixture?utm_source=test&x=1',
        ['zhaopin.jd.com'],
      ),
    ).toBe('https://zhaopin.jd.com/web/job/job_info_list/3?x=1');
  });

  it('passes the common source contract for inline detail', async () => {
    const raw = firstRaw();
    expect(raw).toBeDefined();
    if (!raw) return;
    const cases = defineSourceContractSuite(createJdAdapter, {
      context: context(),
      expectedExternalJobIds: ['221794', '223015', '222845'],
      expectedCoverage: 'complete',
      normalizationCases: [
        {
          discovered: {
            externalJobId: String(raw.requirementId),
            sourceUrl: 'https://zhaopin.jd.com/web/job/job_info_list/3',
            raw,
          },
          detail: null,
        },
      ],
      fixtureText: JSON.stringify({ listPage1, listPage2 }),
    });
    for (const contractCase of cases) await contractCase.run();
  });

  it('normalizes inline responsibilities into official stable entry URLs', async () => {
    const raw = firstRaw();
    expect(raw).toBeDefined();
    if (!raw) return;
    const normalized = await adapter.normalize(
      {
        discovered: {
          externalJobId: String(raw.requirementId),
          sourceUrl: 'https://zhaopin.jd.com/web/job/job_info_list/3',
          raw,
        },
        detail: null,
      },
      { sourceId, companyId, config },
    );
    expect(normalized.job).toMatchObject({
      externalJobId: '221794',
      title: '渠道销售岗',
      department: '京东零售',
      locations: ['北京市'],
      publishedAt: 1787155200000,
    });
    expect(normalized.job.description).toContain('岗位职责');
    expect(normalized.job.detailUrl).toBe('https://zhaopin.jd.com/web/job/job_info_list/3');
    expect(normalized.job.applyUrl).toBe('https://zhaopin.jd.com/web/job/job_info_list/3');
  });

  it('reports partial when a later page is empty before the advertised count', async () => {
    const emptySecond = [];
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
