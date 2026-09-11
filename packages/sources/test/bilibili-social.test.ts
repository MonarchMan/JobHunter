import { readFile } from 'node:fs/promises';
import { parseId } from '@jobhunter/domain';
import {
  collectDiscovery,
  defineSourceContractSuite,
  type DiscoverContext,
  type SourcePageCollection,
} from '@jobhunter/source-core';
import { describe, expect, it, vi } from 'vitest';
import {
  bilibiliDescriptionText,
  bilibiliSocialConfigSchema,
  createBilibiliSocialAdapter,
  parseBilibiliSocialJob,
  parseBilibiliSocialPage,
  parseBilibiliSocialRequest,
  type BilibiliSocialConfig,
} from '../src/index.js';

const fixtureText = await readFile(
  new URL('./fixtures/bilibili/social/job.json', import.meta.url),
  'utf8',
);
const job = parseBilibiliSocialJob(JSON.parse(fixtureText) as unknown);
const config = bilibiliSocialConfigSchema.parse({ pageSize: 1 });

/** 真实公开职位样本加一个显式合成 ID，只用于模拟分页异常，不作在线证据。 */
function collection(): SourcePageCollection {
  return {
    coverage: 'complete',
    pages: [
      {
        page: 1,
        url: 'https://jobs.bilibili.com/social/positions',
        records: [job],
        total: 2,
        capturedAt: 0,
      },
      {
        page: 2,
        url: 'https://jobs.bilibili.com/social/positions',
        records: [{ ...job, id: '900000001' }],
        total: 2,
        capturedAt: 0,
      },
    ],
  };
}

/** 注入固定采样客户端，任何 HTTP 或页面导航都会使离线测试失败。 */
function context(
  value: SourcePageCollection = collection(),
): DiscoverContext<BilibiliSocialConfig> {
  return {
    companyId: parseId('018f0000-0000-7000-8000-000000000117', 'Company'),
    sourceId: parseId('018f0000-0000-7000-8000-000000000249', 'JobSource'),
    requestId: 'bilibili-fixture',
    config,
    cursor: null,
    signal: new AbortController().signal,
    timeoutMs: 1000,
    http: { request: () => Promise.reject(new Error('Offline test must not use HTTP.')) },
    page: {
      snapshot: () => Promise.reject(new Error('Offline test must not navigate.')),
      collect: vi.fn().mockResolvedValue(value),
    },
  };
}

describe('Bilibili social contract (SWT-007, SWT-008)', () => {
  it('passes the shared adapter contract and normalizes official fields', async () => {
    const adapter = createBilibiliSocialAdapter();
    const ctx = context();
    for (const test of defineSourceContractSuite(createBilibiliSocialAdapter, {
      context: ctx,
      expectedExternalJobIds: [job.id, '900000001'],
      expectedCoverage: 'complete',
      normalizationCases: [
        {
          discovered: {
            externalJobId: job.id,
            sourceUrl: `https://jobs.bilibili.com/social/positions/${job.id}`,
            raw: job,
          },
          detail: null,
        },
      ],
      fixtureText,
    }))
      await test.run();
    const normalized = await adapter.normalize(
      {
        discovered: {
          externalJobId: job.id,
          sourceUrl: `https://jobs.bilibili.com/social/positions/${job.id}`,
          raw: job,
        },
        detail: null,
      },
      ctx,
    );
    expect(normalized.job).toMatchObject({
      externalJobId: '28968',
      recruitmentCategory: 'social',
      locations: ['上海'],
      employmentType: '全职',
      publishedAt: Date.parse('2026-09-09T13:21:06Z'),
    });
    expect(normalized.job.description).toContain('工作要求');
    expect(normalized.job.detailUrl).toBe('https://jobs.bilibili.com/social/positions/28968');
    expect(ctx.page?.collect).toHaveBeenCalledWith(
      expect.objectContaining({
        pageSize: 1,
        minimumRequestIntervalMs: 5000,
        responseShape: 'bilibili-social',
      }),
    );
  });

  it.each(['duplicate', 'short', 'missing', 'total', 'page'] as const)(
    'never completes a %s collection',
    async (kind) => {
      const original = collection();
      const first = original.pages[0];
      const last = original.pages[1];
      if (!first || !last) throw new Error('Missing fixture page.');
      const pages =
        kind === 'missing'
          ? [last]
          : [
              first,
              {
                ...last,
                ...(kind === 'duplicate' ? { records: first.records } : {}),
                ...(kind === 'short' ? { records: [] } : {}),
                ...(kind === 'total' ? { total: 3 } : {}),
                ...(kind === 'page' ? { page: 1 } : {}),
              },
            ];
      const result = await collectDiscovery(
        createBilibiliSocialAdapter().discover(context({ ...original, pages })),
      );
      expect(result.completion.coverage).toBe('partial');
      expect(result.completion.diagnostics?.reason).toBeTruthy();
    },
  );

  it('preserves sampled coverage and permits a verified zero result', async () => {
    const adapter = createBilibiliSocialAdapter();
    const sampled = await collectDiscovery(
      adapter.discover(
        context({
          ...collection(),
          coverage: 'partial',
          diagnostics: { reason: 'sampled_pages', retryable: false },
        }),
      ),
    );
    expect(sampled.completion).toMatchObject({
      coverage: 'partial',
      diagnostics: { reason: 'sampled_pages' },
    });
    const empty = await collectDiscovery(
      adapter.discover(
        context({
          coverage: 'complete',
          pages: [],
          diagnostics: { expectedCount: 0, reason: null, retryable: false },
        }),
      ),
    );
    expect(empty.completion).toMatchObject({ coverage: 'complete', discoveredCount: 0 });
    await expect(
      collectDiscovery(adapter.discover(context({ coverage: 'complete', pages: [] }))),
    ).rejects.toMatchObject({ category: 'parse_changed' });
  });

  it('rejects non-social records, changed fields and unavailable sessions', async () => {
    expect(() => parseBilibiliSocialJob({ ...job, recruitType: 1 })).toThrow();
    expect(() => parseBilibiliSocialJob({ ...job, positionDescription: '' })).toThrow();
    expect(() =>
      parseBilibiliSocialPage({ code: -101, data: null, message: 'private session' }),
    ).toThrow('anonymous session');
    expect(() => parseBilibiliSocialPage({ code: 1, data: { total: 0, list: [] } })).toThrow(
      'schema changed',
    );
    expect(() => parseBilibiliSocialPage('<html>verification</html>')).toThrow('schema changed');
    expect(() => parseBilibiliSocialPage({ code: 0, data: { total: 0, list: [job] } })).toThrow(
      'exceeds its total',
    );
    const { page: _page, ...withoutBrowser } = context();
    expect(_page).toBeDefined();
    await expect(async () =>
      collectDiscovery(createBilibiliSocialAdapter().discover(withoutBrowser)),
    ).rejects.toMatchObject({ category: 'access_blocked' });
    expect((await createBilibiliSocialAdapter().healthCheck(withoutBrowser)).errorCategory).toBe(
      'access_blocked',
    );
  });

  it('discards unknown fields and ignores unreliable upstream page counts', () => {
    const result = parseBilibiliSocialPage({
      code: 0,
      data: {
        total: 517,
        pages: 74,
        size: 7,
        list: [{ ...job, unrelatedSecret: 'never persist' }],
      },
    });
    expect(result.total).toBe(517);
    expect(result.records[0]).not.toHaveProperty('unrelatedSecret');
    const body = {
      pageNum: 1,
      pageSize: 50,
      recruitType: 0,
      workTypeList: ['3'],
      positionTypeList: ['3'],
      positionName: '',
      postCode: [],
      postCodeList: [],
      workLocationList: [],
      deptCodeList: [],
      practiceTypes: [],
      onlyHotRecruit: 0,
    };
    expect(parseBilibiliSocialRequest(body)).toEqual({ pageNum: 1, pageSize: 50 });
    expect(() => parseBilibiliSocialRequest({ ...body, onlyHotRecruit: 1 })).toThrow();
    expect(() => parseBilibiliSocialRequest({ ...body, workLocationList: ['上海'] })).toThrow();
    expect(() => bilibiliSocialConfigSchema.parse({ pageSize: 101 })).toThrow();
  });

  it('converts HTML and entities and rejects an overflowing publication date', async () => {
    expect(
      bilibiliDescriptionText(
        '<p>A &amp; B<br/>C</p><script>bad()</script><style>bad</style>&#x4e2d;&#25991;&nbsp;',
      ),
    ).toBe('A & B\nC\n中文');
    const ctx = context();
    await expect(async () =>
      createBilibiliSocialAdapter().normalize(
        {
          discovered: {
            externalJobId: job.id,
            sourceUrl: `https://jobs.bilibili.com/social/positions/${job.id}`,
            raw: { ...job, pushTime: '2026-02-30 01:00:00' },
          },
          detail: null,
        },
        ctx,
      ),
    ).rejects.toMatchObject({ category: 'parse_changed' });
  });

  it('caps health collection to one page', async () => {
    const ctx = context();
    const health = await createBilibiliSocialAdapter().healthCheck(ctx);
    expect(health.status).toBe('healthy');
    expect(ctx.page?.collect).toHaveBeenCalledWith(expect.objectContaining({ maximumPages: 1 }));
  });
});
