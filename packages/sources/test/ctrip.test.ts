import { readFile } from 'node:fs/promises';
import { parseId } from '@jobhunter/domain';
import {
  collectDiscovery,
  defineSourceContractSuite,
  type DiscoverContext,
  type SourceHttpResponse,
} from '@jobhunter/source-core';
import { describe, it, expect } from 'vitest';
import {
  createCtripAdapter,
  ctripSites,
  ctripConfigSchema,
  ctripRequest,
  ctripUrl,
  ctripText,
  parseCtripJob,
  parseCtripPage,
  parseCtripDetail,
  type CtripConfig,
  type CtripKey,
  type CtripJob,
} from '../src/index.js';

const text = await readFile(new URL('./fixtures/ctrip/jobs.json', import.meta.url), 'utf8');
const fixture = JSON.parse(text) as Record<'social' | 'intern' | 'campus', CtripJob>;
/** 合成公开响应，不存储真实 JD 或任何会话内容。 */
function envelope(records: unknown[], total = records.length): unknown {
  return { retCode: '201', retValue: { total, recruitJobAdList: records } };
}
/** 来源契约测试使用离线 HTTP，记录请求页码以验证有限采样。 */
function context(
  key: CtripKey,
  response?: (page: number) => unknown,
): DiscoverContext<CtripConfig> {
  return {
    companyId: parseId('018f0000-0000-7000-8000-000000000119', 'Company'),
    sourceId: parseId('018f0000-0000-7000-8000-000000000258', 'JobSource'),
    requestId: key,
    config: ctripConfigSchema.parse({}),
    cursor: null,
    signal: new AbortController().signal,
    timeoutMs: 1000,
    http: {
      request: (request) => {
        const body = JSON.parse(request.body ?? '{}') as { pager: { index: string } };
        return Promise.resolve({
          status: 200,
          url: request.url,
          headers: new Headers(),
          body: response
            ? response(Number(body.pager.index))
            : envelope([fixture[ctripSites[key].channel]]),
        } as SourceHttpResponse<never>);
      },
    },
  };
}
/** 生成不同稳定 ID 的分页样本，避免真实网络依赖。 */
function rows(start: number, count: number): CtripJob[] {
  return Array.from({ length: count }, (_, i) => ({
    ...fixture.social,
    fromId: `MJ${String(900000 + start + i)}`,
  }));
}
describe('Ctrip production protocol (SWT-018)', () => {
  for (const key of Object.keys(ctripSites) as CtripKey[]) {
    const job = fixture[ctripSites[key].channel];
    const discovered = {
      externalJobId: job.fromId,
      sourceUrl: ctripUrl(key, job.fromId),
      raw: job,
    };
    for (const test of defineSourceContractSuite(() => createCtripAdapter(key), {
      context: context(key),
      expectedExternalJobIds: [job.fromId],
      expectedCoverage: 'complete',
      normalizationCases: [{ discovered, detail: null }],
      fixtureText: text,
    }))
      it(`${key}: ${test.name}`, () => test.run());
    it(`${key}: uses official filters, stable URLs and language preference only`, async () => {
      const ctx = context(key);
      const request = ctripRequest(key, ctx, 2);
      expect(JSON.parse(request.body ?? '{}')).toMatchObject({
        condition: {
          kind: [job.kind],
          category: Number(job.category),
          city: [],
          country: [],
          fromId: [],
        },
        pager: { index: '2', size: '10' },
      });
      expect(request.headers).toEqual({
        'Content-Type': 'application/json;charset=UTF-8',
        Cookie: 'language=zh-CN',
      });
      const normalized = await createCtripAdapter(key).normalize({ discovered, detail: null }, ctx);
      expect(normalized.job.recruitmentCategory).toBe(
        ctripSites[key].channel === 'intern' ? 'internship' : ctripSites[key].channel,
      );
      expect(normalized.job.locations).toEqual([job.cityName]);
      expect(normalized.job.publishedAt).toBe(Date.parse('2026-09-09T16:00:00Z'));
      expect(normalized.sourcePrivateJson).toEqual({});
      expect(parseCtripDetail(envelope([job]), key, job.fromId)).toEqual(job);
    });
  }
  it.each([
    ['complete', 21, (p: number) => envelope(rows((p - 1) * 10, p === 3 ? 1 : 10), 21), null],
    [
      'partial',
      21,
      (p: number) => envelope(rows((p - 1) * 10, p === 3 ? 0 : 10), 21),
      'invalid_page_boundary',
    ],
    ['partial', 21, (p: number) => envelope(rows(0, p === 3 ? 1 : 10), 21), 'duplicate_job_ids'],
    [
      'partial',
      21,
      (p: number) => envelope(rows((p - 1) * 10, p === 3 ? 1 : 10), p === 1 ? 21 : 22),
      'pagination_total_changed',
    ],
  ] as const)('pagination %s / %s / %s / %s', async (coverage, _total, response, reason) => {
    const result = await collectDiscovery(
      createCtripAdapter('ctrip.social').discover(context('ctrip.social', response)),
    );
    expect(result.completion).toMatchObject({ coverage, diagnostics: { reason } });
  });
  it.each([2, 3])(
    'samples at most %s pages including first and last, never complete',
    async (maximumPages) => {
      const requested: number[] = [];
      const ctx = context('ctrip.social', (p) => {
        requested.push(p);
        return envelope(rows((p - 1) * 10, p === 6 ? 7 : 10), 57);
      });
      const result = await collectDiscovery(
        createCtripAdapter('ctrip.social').discover({
          ...ctx,
          config: ctripConfigSchema.parse({ maximumPages, pageSampling: 'first-last' }),
        }),
      );
      expect(requested).toEqual(maximumPages === 2 ? [1, 6] : [1, 3, 6]);
      expect(result.completion).toMatchObject({
        coverage: 'partial',
        diagnostics: { reason: 'sampled_pages', duplicateIds: 0, totalChanged: false },
      });
    },
  );
  it('bounds sequential requests and checks health with first page only', async () => {
    const calls: number[] = [];
    const ctx = context('ctrip.social', (p) => {
      calls.push(p);
      return envelope(rows(0, 10), 100);
    });
    const adapter = createCtripAdapter('ctrip.social');
    expect((await adapter.healthCheck(ctx)).status).toBe('healthy');
    expect(calls).toEqual([1]);
    const result = await collectDiscovery(
      adapter.discover({ ...ctx, config: ctripConfigSchema.parse({ maximumPages: 1 }) }),
    );
    expect(result.completion.diagnostics?.reason).toBe('maximum_pages_reached');
  });
  it('distinguishes legitimate zero from failed/malformed responses and preserves safe diagnostics', async () => {
    const adapter = createCtripAdapter('ctrip.social');
    const ctx = context('ctrip.social', () => envelope([]));
    expect((await collectDiscovery(adapter.discover(ctx))).completion).toMatchObject({
      coverage: 'complete',
      discoveredCount: 0,
    });
    expect((await adapter.healthCheck(ctx)).status).toBe('degraded');
    for (const bad of [
      { retCode: '500', retMessage: 'internal private message' },
      {},
      envelope([], -1),
      '<html>verify</html>',
    ]) {
      expect(() => parseCtripPage(bad, 'ctrip.social')).toThrow();
      const health = await adapter.healthCheck(context('ctrip.social', () => bad));
      expect(health.errorCategory).toBe('parse_changed');
      expect(JSON.stringify(health)).not.toContain('internal private message');
    }
  });
  it('rejects cross-channel records, empty bodies, invalid identities and dates', () => {
    for (const overrides of [
      { kind: '3' },
      { category: '2' },
      { requirements: '<p>&nbsp;</p>' },
      { fromId: '../bad' },
      { publishDate: '2026-02-30' },
      { publishDate: 'invalid' },
    ])
      expect(() => parseCtripJob({ ...fixture.social, ...overrides }, 'ctrip.social')).toThrow();
    expect(() => parseCtripDetail(envelope([fixture.social]), 'ctrip.social', 'MJ999')).toThrow();
    expect(() => ctripUrl('ctrip.social', '../bad')).toThrow();
    expect(() => ctripConfigSchema.parse({ pageSize: 50 })).toThrow();
    expect(() => ctripConfigSchema.parse({ maximumPages: 0 })).toThrow();
  });
  it('strips internal fields, decodes plain text, leaves unknown location unset and binds normalize identity', async () => {
    const job = parseCtripJob(
      { ...fixture.social, cityName: null, user: 'private', hrDutyUser: 'private' },
      'ctrip.social',
    );
    expect(job).not.toHaveProperty('user');
    expect(job).not.toHaveProperty('hrDutyUser');
    expect(
      ctripText('<style>bad</style><p>A &amp; B</p><script>bad()</script>&#x4e2d;&#25991;'),
    ).toBe('A & B\n中文');
    const adapter = createCtripAdapter('ctrip.social');
    const discovered = {
      externalJobId: job.fromId,
      sourceUrl: ctripUrl('ctrip.social', job.fromId),
      raw: job,
    };
    expect(
      (await adapter.normalize({ discovered, detail: null }, context('ctrip.social'))).job
        .locations,
    ).toEqual([]);
    expect(() =>
      adapter.normalize(
        { discovered: { ...discovered, externalJobId: 'MJ999' }, detail: null },
        context('ctrip.social'),
      ),
    ).toThrow();
  });
  it('propagates cancellation and network failures instead of completing empty', async () => {
    const ctx = context('ctrip.social');
    await expect(
      collectDiscovery(
        createCtripAdapter('ctrip.social').discover({ ...ctx, signal: AbortSignal.abort() }),
      ),
    ).rejects.toMatchObject({ category: 'temporary' });
    const failed = {
      ...ctx,
      http: { request: () => Promise.reject(new Error('network failure')) },
    };
    await expect(
      collectDiscovery(createCtripAdapter('ctrip.social').discover(failed)),
    ).rejects.toThrow('network failure');
    expect((await createCtripAdapter('ctrip.social').healthCheck(failed)).status).toBe('unhealthy');
  });
});
