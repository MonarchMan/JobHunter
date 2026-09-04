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
  createPinduoduoAdapter,
  pinduoduoConfigSchema,
  type PinduoduoConfig,
  type PinduoduoListResponse,
} from '../src/index.js';

const companyId = parseId('018f0000-0000-7000-8000-000000000105', 'Company');
const sourceId = parseId('018f0000-0000-7000-8000-000000000205', 'JobSource');
const config = pinduoduoConfigSchema.parse({ pageSize: 10 });
let fixture: PinduoduoListResponse;

beforeAll(async () => {
  fixture = JSON.parse(
    await readFile(new URL('./fixtures/pinduoduo/intern-page-1.json', import.meta.url), 'utf8'),
  ) as PinduoduoListResponse;
});

/** 构造测试输入或执行断言的辅助逻辑。 */
function response<T>(body: T, url: string): SourceHttpResponse<T> {
  return { status: 200, url, headers: new Headers({ 'content-type': 'application/json' }), body };
}

/** 构造测试输入或执行断言的辅助逻辑。 */
function context(http: SourceHttpClient = fixtureHttp()): DiscoverContext<PinduoduoConfig> {
  return {
    sourceId,
    companyId,
    requestId: 'pinduoduo-fixture',
    config,
    signal: new AbortController().signal,
    timeoutMs: 1_000,
    http,
    cursor: null,
  };
}

/** 构造测试输入或执行断言的辅助逻辑。 */
function fixtureHttp(): SourceHttpClient {
  return {
    request<TBody>(request: SourceHttpRequest): Promise<SourceHttpResponse<TBody>> {
      return Promise.resolve(response(fixture as TBody, request.url));
    },
  };
}

describe('Pinduoduo campus intern source adapter', () => {
  const adapter = createPinduoduoAdapter();

  it('discovers the checked-in intern list and reports complete coverage', async () => {
    const discovery = await collectDiscovery(adapter.discover(context()));
    expect(discovery.completion).toMatchObject({
      coverage: 'complete',
      discoveredCount: 2,
      pages: 1,
    });
    expect(discovery.ids).toEqual([
      '8999575e-951d-43ad-b262-2abb1a920787',
      'c1fe33d8-c73e-46e5-9fae-8163c9d9b4ce',
    ]);
  });

  it('normalizes internship fields and official detail URLs', async () => {
    const raw = fixture.result.list[0];
    const normalized = await adapter.normalize(
      {
        discovered: {
          externalJobId: raw.id,
          sourceUrl: `https://careers.pddglobalhr.com/campus/intern/detail?positionId=${raw.id}`,
          raw,
        },
        detail: null,
      },
      { sourceId, companyId, config },
    );
    expect(normalized.job).toMatchObject({
      externalJobId: raw.id,
      title: 'HR实习生',
      employmentType: '实习',
      locations: ['上海市'],
    });
    expect(normalized.job.detailUrl).toContain('/campus/intern/detail?positionId=');
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
