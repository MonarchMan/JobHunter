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
  baiduConfigSchema,
  baiduListResponseSchema,
  createBaiduAdapter,
  type BaiduConfig,
  type BaiduJob,
  type BaiduRecruitType,
} from '../src/index.js';

const companyId = parseId('018f0000-0000-7000-8000-000000000103', 'Company');
const sourceId = parseId('018f0000-0000-7000-8000-000000000203', 'JobSource');
const config = baiduConfigSchema.parse({ pageSize: 1 });
let internJobs: BaiduJob[];
let graduateJobs: BaiduJob[];
let fixtureText: string;

async function fixture(name: string): Promise<{ readonly text: string; readonly value: unknown }> {
  const text = await readFile(new URL(`./fixtures/baidu/${name}`, import.meta.url), 'utf8');
  return { text, value: JSON.parse(text) as unknown };
}

beforeAll(async () => {
  const [intern, graduate] = await Promise.all([
    fixture('intern-page.json'),
    fixture('graduate-page.json'),
  ]);
  internJobs = baiduListResponseSchema.parse(intern.value).data.list;
  graduateJobs = baiduListResponseSchema.parse(graduate.value).data.list;
  fixtureText = `${intern.text}\n${graduate.text}`;
});

function response<T>(body: T, url: string): SourceHttpResponse<T> {
  return { status: 200, url, headers: new Headers({ 'content-type': 'application/json' }), body };
}

function fixtureHttp(options: { readonly duplicateIntern?: boolean } = {}): SourceHttpClient {
  return {
    request<TBody>(request: SourceHttpRequest): Promise<SourceHttpResponse<TBody>> {
      const body = new URLSearchParams(request.body ?? '');
      const recruitType = body.get('recruitType') as BaiduRecruitType;
      const pageSize = Number(body.get('pageSize'));
      const page = Number(body.get('curPage'));
      const source = recruitType === 'INTERN' ? internJobs : graduateJobs;
      const start = (page - 1) * pageSize;
      const list = source.slice(start, start + pageSize);
      if (options.duplicateIntern && recruitType === 'INTERN' && page === 2) {
        list.splice(0, list.length, internJobs[0]);
      }
      return Promise.resolve(
        response(
          {
            status: 'ok',
            message: 'success',
            data: { pageNum: page, pageSize, total: String(source.length), list },
          } as TBody,
          request.url,
        ),
      );
    },
  };
}

function context(http: SourceHttpClient = fixtureHttp()): DiscoverContext<BaiduConfig> {
  return {
    sourceId,
    companyId,
    requestId: 'baidu-fixture',
    config,
    signal: new AbortController().signal,
    timeoutMs: 1_000,
    http,
    cursor: null,
  };
}

describe('Baidu campus source adapter', () => {
  const adapter = createBaiduAdapter();

  it('uses the verified form protocol and collects internships before graduate jobs', async () => {
    const requests: URLSearchParams[] = [];
    const delegate = fixtureHttp();
    const http: SourceHttpClient = {
      request<TBody>(request: SourceHttpRequest): Promise<SourceHttpResponse<TBody>> {
        expect(request.headers['content-type']).toContain('application/x-www-form-urlencoded');
        requests.push(new URLSearchParams(request.body ?? ''));
        return delegate.request<TBody>(request);
      },
    };
    const discovery = await collectDiscovery(adapter.discover(context(http)));
    expect(discovery.completion).toMatchObject({
      coverage: 'complete',
      pages: 3,
      discoveredCount: 3,
    });
    expect(discovery.ids).toEqual([
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
    ]);
    expect(requests.map((body) => [body.get('recruitType'), body.get('curPage')])).toEqual([
      ['INTERN', '1'],
      ['INTERN', '2'],
      ['GRADUATE', '1'],
    ]);
  });

  it('passes the common source contract with inline job facts', async () => {
    const raw = internJobs[0];
    expect(raw).toBeDefined();
    if (!raw) return;
    const cases = defineSourceContractSuite(createBaiduAdapter, {
      context: context(),
      expectedExternalJobIds: [
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
        '33333333-3333-4333-8333-333333333333',
      ],
      expectedCoverage: 'complete',
      normalizationCases: [
        {
          discovered: {
            externalJobId: raw.postId,
            sourceUrl: `https://talent.baidu.com/jobs/detail/INTERN/${raw.postId}`,
            raw: { ...raw, recruitType: 'INTERN' },
          },
          detail: null,
        },
      ],
      fixtureText,
    });
    for (const contractCase of cases) await contractCase.run();
  });

  it('normalizes internship fields and stable official detail URLs', async () => {
    const raw = internJobs[0];
    expect(raw).toBeDefined();
    if (!raw) return;
    const normalized = await adapter.normalize(
      {
        discovered: {
          externalJobId: raw.postId,
          sourceUrl: `https://talent.baidu.com/jobs/detail/INTERN/${raw.postId}`,
          raw: { ...raw, recruitType: 'INTERN' },
        },
        detail: null,
      },
      { sourceId, companyId, config },
    );
    expect(normalized.job).toMatchObject({
      externalJobId: raw.postId,
      title: 'AI产品实习生（J100001）',
      department: '移动生态事业群',
      jobFamily: '产品',
      locations: ['上海市', '北京市'],
      employmentType: '实习',
      educationText: '本科',
    });
    expect(normalized.job.description).toContain('岗位职责');
    expect(normalized.job.description).toContain('任职要求');
    expect(normalized.job.detailUrl).toContain('/jobs/detail/INTERN/');
  });

  it('reports partial coverage when a stable ID repeats', async () => {
    const discovery = await collectDiscovery(
      adapter.discover(context(fixtureHttp({ duplicateIntern: true }))),
    );
    expect(discovery.completion).toMatchObject({ coverage: 'partial', discoveredCount: 2 });
  });

  it('preserves access-blocked failures and health diagnostics', async () => {
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
