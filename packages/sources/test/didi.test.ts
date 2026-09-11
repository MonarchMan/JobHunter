import { readFile } from 'node:fs/promises';
import { parseId } from '@jobhunter/domain';
import {
  collectDiscovery,
  AdapterRegistry,
  defineSourceContractSuite,
  type DiscoverContext,
  type SourcePageCollection,
  type SourceHttpResponse,
  type SourcePageCollectionRequest,
} from '@jobhunter/source-core';
import { describe, it, expect, vi } from 'vitest';
import {
  createDidiAdapter,
  didiSites,
  didiConfigSchema,
  parseDidiPage,
  parseDidiDetail,
  parseDidiJob,
  validateDidiCollection,
  didiText,
  didiPageNumbers,
  type DidiKey,
  type DidiConfig,
  type DidiJob,
} from '../src/index.js';

const text = await readFile(new URL('./fixtures/didi/jobs.json', import.meta.url), 'utf8');
const fixture = JSON.parse(text) as {
  socialList: unknown;
  socialDetail: unknown;
  intern: Record<string, unknown>;
  campus: Record<string, unknown>;
};
/** 用合成非空校园记录验证未来精英协议，不替代该站的线上详情门禁。 */
function listed(key: DidiKey): DidiJob {
  const job = parseDidiPage(
    key === 'didi.social'
      ? fixture.socialList
      : {
          jobStats: { orgId: 'didiglobal', total: 1 },
          jobs: [key === 'didi.intern' ? fixture.intern : fixture.campus],
        },
    key,
  ).records[0];
  if (!job) throw new Error('Missing synthetic Didi job.');
  return job;
}
/** 离线客户端不得访问网络；详情独立返回并验证 ID。 */
function context(key: DidiKey, value?: SourcePageCollection): DiscoverContext<DidiConfig> {
  const job = listed(key);
  return {
    companyId: parseId('018f0000-0000-7000-8000-000000000118', 'Company'),
    sourceId: parseId('018f0000-0000-7000-8000-000000000254', 'JobSource'),
    requestId: key,
    config: didiConfigSchema(key).parse({}),
    cursor: null,
    signal: new AbortController().signal,
    timeoutMs: 1000,
    http: {
      request: (request) =>
        Promise.resolve({
          status: 200,
          url: request.url,
          headers: new Headers(),
          body: request.url.includes('/view/') ? fixture.socialDetail : fixture.socialList,
        } as SourceHttpResponse<never>),
    },
    page: {
      snapshot: () => Promise.reject(new Error('No offline navigation.')),
      collect: vi.fn().mockImplementation((request: SourcePageCollectionRequest) =>
        Promise.resolve(
          request.responseShape === 'didi-moka-detail'
            ? {
                coverage: 'complete',
                pages: [
                  {
                    page: 1,
                    url: request.url,
                    total: 1,
                    capturedAt: 0,
                    records: [{ ...job, description: '合成测试职责\n合成测试要求' }],
                  },
                ],
              }
            : (value ?? {
                coverage: 'complete',
                pages: [
                  { page: 1, url: didiSites[key].entry, total: 1, capturedAt: 0, records: [job] },
                ],
              }),
        ),
      ),
    },
  };
}
describe('Didi contracts and public schemas (SWT-013, SWT-014)', () => {
  it('validates actual social page/size echoes and never invents them (SWT-017)', () => {
    const raw = fixture.socialList as { meta: unknown; data: Record<string, unknown> };
    for (const data of [
      { ...raw.data, page: 2 },
      { ...raw.data, page: undefined },
      { ...raw.data, size: 10 },
      { ...raw.data, size: undefined },
    ])
      expect(() => parseDidiPage({ ...raw, data }, 'didi.social', 1)).toThrow();
    expect(
      parseDidiPage({ ...raw, data: { ...raw.data, page: 65 } }, 'didi.social', 65).records,
    ).toHaveLength(1);
  });
  it('requires a fetchDetail implementation for required metadata (SWT-016)', () => {
    const adapter = createDidiAdapter('didi.intern');
    expect(adapter.metadata.capabilities.detail).toBe('required');
    const { fetchDetail, ...withoutDetail } = adapter;
    expect(fetchDetail).toBeTypeOf('function');
    expect(() => {
      new AdapterRegistry().register(withoutDetail);
    }).toThrow('requires fetchDetail');
    expect(() => {
      new AdapterRegistry().register(adapter);
    }).not.toThrow();
  });
  it.each(['complete', 'partial'] as const)(
    'counts paused rows for boundaries but excludes active discovery: %s',
    async (coverage) => {
      const key = 'didi.intern';
      const paused = parseDidiPage(
        {
          jobStats: { orgId: 'didiglobal', total: 1 },
          jobs: [{ ...fixture.intern, status: 'pause' }],
        },
        key,
      ).records[0];
      if (!paused) throw new Error('Missing paused fixture.');
      const ctx = context(key, {
        coverage,
        pages: [{ page: 1, url: didiSites[key].entry, total: 1, records: [paused], capturedAt: 0 }],
      });
      const adapter = createDidiAdapter(key);
      const result = await collectDiscovery(adapter.discover(ctx));
      expect(result.completion).toMatchObject({
        coverage,
        discoveredCount: 0,
        diagnostics: { expectedCount: coverage === 'complete' ? 0 : null },
      });
      expect((await adapter.healthCheck(ctx)).status).toBe('degraded');
      await expect(async () =>
        adapter.normalize(
          {
            discovered: {
              externalJobId: paused.id,
              sourceUrl: didiSites[key].detail + paused.id,
              raw: paused,
            },
            detail: paused,
          },
          ctx,
        ),
      ).rejects.toMatchObject({ category: 'not_found' });
      expect(() =>
        parseDidiPage(
          {
            jobStats: { orgId: 'didiglobal', total: 1 },
            jobs: [{ ...fixture.intern, status: 'unknown' }],
          },
          key,
        ),
      ).toThrow();
    },
  );
  for (const key of Object.keys(didiSites) as DidiKey[]) {
    it(`${key}: shared contract, safe normalization, single-page health`, async () => {
      const adapter = createDidiAdapter(key);
      const ctx = context(key);
      const raw = listed(key);
      const discovered = {
        externalJobId: raw.id,
        sourceUrl: `${didiSites[key].detail}${raw.id}`,
        raw,
      };
      const detail = adapter.fetchDetail ? await adapter.fetchDetail(discovered, ctx) : null;
      for (const test of defineSourceContractSuite(() => createDidiAdapter(key), {
        context: ctx,
        expectedExternalJobIds: [raw.id],
        expectedCoverage: 'complete',
        normalizationCases: [{ discovered, detail }],
        fixtureText: text,
      }))
        await test.run();
      const result = await adapter.normalize({ discovered, detail }, ctx);
      expect(result.job.recruitmentCategory).toBe(
        didiSites[key].channel === 'intern' ? 'internship' : didiSites[key].channel,
      );
      expect(result.job.description).toContain('合成测试');
      if (key === 'didi.intern') expect(result.job.locations).toEqual([]);
      expect((await adapter.healthCheck(ctx)).status).toBe('healthy');
      if (key !== 'didi.social')
        expect(ctx.page?.collect).toHaveBeenLastCalledWith(
          expect.objectContaining({ maximumPages: 1 }),
        );
      await expect(async () =>
        adapter.normalize({ discovered: { ...discovered, externalJobId: 'wrong' }, detail }, ctx),
      ).rejects.toMatchObject({ category: 'parse_changed' });
    });
    it.each(['short', 'missing', 'duplicate', 'total', 'page'])(
      `${key}: %s never completes`,
      (kind) => {
        const job = listed(key);
        const first = {
          page: 1,
          url: didiSites[key].entry,
          total: 2,
          capturedAt: 0,
          records: [job],
        };
        const second = {
          ...first,
          page: 2,
          records: [
            {
              ...job,
              id: key === 'didi.social' ? '900000001' : '018f0000-0000-7000-8000-000000000777',
            },
          ],
        };
        const pages =
          kind === 'missing'
            ? [second]
            : [
                first,
                {
                  ...second,
                  ...(kind === 'short' ? { records: [] } : {}),
                  ...(kind === 'duplicate' ? { records: first.records } : {}),
                  ...(kind === 'total' ? { total: 3 } : {}),
                  ...(kind === 'page' ? { page: 1 } : {}),
                },
              ];
        expect(validateDidiCollection({ coverage: 'complete', pages }, key, 1).coverage).toBe(
          'partial',
        );
      },
    );
    it(`${key}: preserves sampling and verified zero`, () => {
      const job = listed(key);
      expect(
        validateDidiCollection(
          {
            coverage: 'partial',
            pages: [
              { page: 1, url: didiSites[key].entry, total: 1, capturedAt: 0, records: [job] },
            ],
            diagnostics: { reason: 'sampled_pages', retryable: false },
          },
          key,
          1,
        ).coverage,
      ).toBe('partial');
      expect(
        validateDidiCollection(
          {
            coverage: 'complete',
            pages: [{ page: 1, url: didiSites[key].entry, total: 0, capturedAt: 0, records: [] }],
          },
          key,
          1,
        ).coverage,
      ).toBe('complete');
      expect(() => validateDidiCollection({ coverage: 'complete', pages: [] }, key, 1)).toThrow();
    });
  }
  it('uses fixed capacity and explicit bounded first/last selection', () => {
    expect(() => didiConfigSchema('didi.social').parse({ pageSize: 50 })).toThrow();
    expect(() => didiConfigSchema('didi.intern').parse({ keyword: '研发' })).toThrow();
    expect(didiPageNumbers(1036, 16, 2, 'first-last')).toEqual([1, 65]);
    expect(didiPageNumbers(151, 30, 3, 'first-last')).toEqual([1, 3, 6]);
    expect(didiPageNumbers(0, 30, 2, 'first-last')).toEqual([1]);
  });
  it('rejects business failures, wrong org/channel/detail, missing bodies and invalid dates', async () => {
    expect(() => parseDidiPage({ meta: { code: 10039 }, data: null }, 'didi.social')).toThrow(
      'anonymous',
    );
    expect(() =>
      parseDidiPage({ meta: { code: 1 }, data: { total: 0, items: [] } }, 'didi.social'),
    ).toThrow();
    expect(() => parseDidiPage({ data: 'encrypted' }, 'didi.intern')).toThrow();
    expect(() =>
      parseDidiPage({ jobStats: { orgId: 'other', total: 0 }, jobs: [] }, 'didi.intern'),
    ).toThrow();
    expect(() =>
      parseDidiPage(
        { jobStats: { orgId: 'didiglobal', total: 1 }, jobs: [fixture.campus] },
        'didi.intern',
      ),
    ).toThrow();
    expect(() =>
      parseDidiDetail(
        { ...fixture.intern, id: '018f0000-0000-7000-8000-000000000777', jobDescription: '正文' },
        'didi.intern',
        listed('didi.intern'),
      ),
    ).toThrow();
    expect(() =>
      parseDidiDetail(
        { ...fixture.intern, publishedAt: '2026-02-30T10:00:00', jobDescription: '正文' },
        'didi.intern',
        listed('didi.intern'),
      ),
    ).toThrow();
    const adapter = createDidiAdapter('didi.intern');
    const ctx = context('didi.intern');
    const job = listed('didi.intern');
    await expect(async () =>
      adapter.normalize(
        {
          discovered: {
            externalJobId: job.id,
            sourceUrl: `${didiSites['didi.intern'].detail}${job.id}`,
            raw: job,
          },
          detail: null,
        },
        ctx,
      ),
    ).rejects.toMatchObject({ category: 'parse_changed' });
    const { page: ignored, ...without } = ctx;
    expect(ignored).toBeDefined();
    await expect(collectDiscovery(adapter.discover(without))).rejects.toMatchObject({
      category: 'access_blocked',
    });
    expect((await adapter.healthCheck(without)).errorCategory).toBe('access_blocked');
  });
  it('strips unknown fields and normalizes HTML/entities with China timezone', () => {
    const job = parseDidiDetail(
      {
        ...fixture.intern,
        jobDescription: '<p>A &amp; B</p><script>bad()</script>&#x4e2d;&#25991;',
        internalOnly: 'do not persist',
      },
      'didi.intern',
      listed('didi.intern'),
    );
    expect(job.description).toBe('A & B\n中文');
    expect(job.publishedAt).toBe(Date.parse('2026-09-11T03:18:33Z'));
    expect(job).not.toHaveProperty('internalOnly');
    expect(didiText('<style>bad</style>A<br>B')).toBe('A\nB');
    expect(() => parseDidiJob({ ...job, channel: 'social' }, 'didi.intern')).toThrow();
  });
});
