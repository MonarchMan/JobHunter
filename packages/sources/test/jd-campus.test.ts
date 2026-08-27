import { readFile } from 'node:fs/promises';
import { parseId } from '@jobhunter/domain';
import {
  SourceError,
  collectDiscovery,
  type DiscoverContext,
  type SourceHttpClient,
  type SourceHttpRequest,
  type SourceHttpResponse,
} from '@jobhunter/source-core';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  createJdCampusAdapter,
  jdCampusConfigSchema,
  type JdCampusConfig,
  type JdCampusListResponse,
} from '../src/index.js';

const companyId = parseId('018f0000-0000-7000-8000-000000000109', 'Company');
const sourceId = parseId('018f0000-0000-7000-8000-000000000209', 'JobSource');
const config = jdCampusConfigSchema.parse({ pageSize: 10 });
let fixture: JdCampusListResponse;

beforeAll(async () => {
  fixture = JSON.parse(
    await readFile(new URL('./fixtures/jd-campus/page-1.json', import.meta.url), 'utf8'),
  ) as JdCampusListResponse;
});

function response<T>(body: T, url: string): SourceHttpResponse<T> {
  return { status: 200, url, headers: new Headers({ 'content-type': 'application/json' }), body };
}

function context(http: SourceHttpClient = fixtureHttp()): DiscoverContext<JdCampusConfig> {
  return {
    sourceId,
    companyId,
    requestId: 'jd-campus-fixture',
    config,
    signal: new AbortController().signal,
    timeoutMs: 1_000,
    http,
    cursor: null,
  };
}

function fixtureHttp(): SourceHttpClient {
  return {
    request<TBody>(request: SourceHttpRequest): Promise<SourceHttpResponse<TBody>> {
      return Promise.resolve(response(fixture as TBody, request.url));
    },
  };
}

describe('JD campus source adapter', () => {
  const adapter = createJdCampusAdapter();

  it('discovers and deduplicates campus positions by publishId', async () => {
    const discovery = await collectDiscovery(adapter.discover(context()));
    expect(discovery.completion).toMatchObject({
      coverage: 'complete',
      discoveredCount: 2,
      pages: 1,
    });
  });

  it('normalizes internship descriptions and requirement locations', async () => {
    const raw = fixture.body.items[0];
    const normalized = await adapter.normalize(
      {
        discovered: {
          externalJobId: String(raw.publishId),
          sourceUrl: 'https://campus.jd.com/home',
          raw,
        },
        detail: null,
      },
      { sourceId, companyId, config },
    );
    expect(normalized.job).toMatchObject({
      externalJobId: '4864',
      title: '物流运营',
      employmentType: '实习',
      locations: ['北京市-北京市', '广东省-广州市'],
      detailUrl: 'https://campus.jd.com/#/details?id=4864&type=present',
      applyUrl: 'https://campus.jd.com/#/details?id=4864&type=present',
    });
    expect(normalized.job.description).toContain('岗位职责');
  });

  it('reports partial coverage when publishId repeats', async () => {
    const duplicateFixture = {
      ...fixture,
      body: {
        ...fixture.body,
        totalNumber: 2,
        items: [fixture.body.items[0], fixture.body.items[0]],
      },
    };
    const duplicateHttp: SourceHttpClient = {
      request<TBody>(request: SourceHttpRequest) {
        return Promise.resolve(response(duplicateFixture as TBody, request.url));
      },
    };
    const discovery = await collectDiscovery(adapter.discover(context(duplicateHttp)));
    expect(discovery.completion).toMatchObject({ coverage: 'partial', discoveredCount: 1 });
  });

  it('classifies access-blocked responses without masking them', async () => {
    const blocked: SourceHttpClient = {
      request: () => Promise.reject(new SourceError('access_blocked', 'Fixture challenge.')),
    };
    await expect(collectDiscovery(adapter.discover(context(blocked)))).rejects.toMatchObject({
      category: 'access_blocked',
    });
    await expect(adapter.healthCheck(context(blocked))).resolves.toMatchObject({
      status: 'unhealthy',
      errorCategory: 'access_blocked',
    });
  });
});
