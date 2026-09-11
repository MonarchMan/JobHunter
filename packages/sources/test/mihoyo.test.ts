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
  createMihoyoAdapter,
  mihoyoSites,
  mihoyoConfigSchema,
  mihoyoRequest,
  mihoyoUrl,
  parseMihoyoJob,
  parseMihoyoPage,
  parseMihoyoDetail,
  type MihoyoConfig,
  type MihoyoKey,
  type MihoyoDetail,
} from '../src/index.js';

const text = await readFile(new URL('./fixtures/mihoyo/jobs.json', import.meta.url), 'utf8');
const fixture = JSON.parse(text) as Record<'social' | 'intern' | 'campus', MihoyoDetail>;
/** 合成公开响应，与真实用户或职位正文无关。 */
function envelope(data: unknown): unknown {
  return { code: 0, success: true, data };
}
/** 合成具有回显的分页响应。 */
function page(records: unknown[], total = records.length, pageNo = 1): unknown {
  return envelope({ list: records, total, pageNo, pageSize: 10 });
}
/** 测试 HTTP 仅返回 fixture，列表和详情均使用生产请求路径。 */
function context(
  key: MihoyoKey,
  response?: (page: number) => unknown,
): DiscoverContext<MihoyoConfig> {
  const job = fixture[mihoyoSites[key].channel];
  return {
    companyId: parseId('018f0000-0000-7000-8000-000000000120', 'Company'),
    sourceId: parseId('018f0000-0000-7000-8000-000000000261', 'JobSource'),
    requestId: key,
    config: mihoyoConfigSchema.parse({}),
    cursor: null,
    signal: new AbortController().signal,
    timeoutMs: 1000,
    http: {
      request: (request) => {
        const body = JSON.parse(request.body ?? '{}') as { pageNo: number };
        return Promise.resolve({
          status: 200,
          url: request.url,
          headers: new Headers(),
          body: request.url.endsWith('/info')
            ? envelope(job)
            : response
              ? response(body.pageNo)
              : page([job]),
        } as SourceHttpResponse<never>);
      },
    },
  };
}
/** 不同 ID 的分页样本，用于检测重复和短页。 */
function rows(start: number, count: number): MihoyoDetail[] {
  return Array.from({ length: count }, (_, i) => ({
    ...fixture.social,
    id: String(900000 + start + i),
  }));
}
describe('Mihoyo protocol and required detail (SWT-019)', () => {
  it('includes official third-party social positions without presenting them as direct employment', async () => {
    const detail = parseMihoyoDetail(
      envelope({ ...fixture.social, jobNatureId: 5, jobNature: '第三方编制' }),
      'mihoyo.social',
      fixture.social.id,
    );
    const normalized = await createMihoyoAdapter('mihoyo.social').normalize(
      {
        discovered: {
          externalJobId: detail.id,
          sourceUrl: mihoyoUrl('mihoyo.social', detail.id),
          raw: parseMihoyoJob(detail, 'mihoyo.social'),
        },
        detail,
      },
      context('mihoyo.social'),
    );
    expect(normalized.job.employmentType).toBe('第三方编制');
    expect(normalized.job.recruitmentCategory).toBe('social');
    expect(() => parseMihoyoJob(detail, 'mihoyo.campus')).toThrow();
  });
  for (const key of Object.keys(mihoyoSites) as MihoyoKey[]) {
    const job = fixture[mihoyoSites[key].channel];
    const discovered = {
      externalJobId: job.id,
      sourceUrl: mihoyoUrl(key, job.id),
      raw: parseMihoyoJob(job, key),
    };
    for (const test of defineSourceContractSuite(() => createMihoyoAdapter(key), {
      context: context(key),
      expectedExternalJobIds: [job.id],
      expectedCoverage: 'complete',
      normalizationCases: [{ discovered, detail: job }],
      fixtureText: text,
    }))
      it(`${key}: ${test.name}`, () => test.run());
    it(`${key}: uses official filters and requires a matching public detail`, async () => {
      const ctx = context(key);
      const request = mihoyoRequest(key, ctx, 2);
      expect(JSON.parse(request.body ?? '{}')).toEqual({
        channelDetailIds: [1],
        hireType: job.hireType,
        ...(job.hireType === 1 ? { jobNatures: [job.jobNatureId] } : {}),
        pageNo: 2,
        pageSize: 10,
      });
      expect(request.headers).toEqual({ 'Content-Type': 'application/json' });
      const adapter = createMihoyoAdapter(key);
      if (!adapter.fetchDetail) throw new Error('Required detail missing.');
      const detail = await adapter.fetchDetail(discovered, ctx);
      const normalized = await adapter.normalize({ discovered, detail }, ctx);
      expect(normalized.job.recruitmentCategory).toBe(
        mihoyoSites[key].channel === 'intern' ? 'internship' : mihoyoSites[key].channel,
      );
      expect(normalized.job.description).toBe(
        `工作职责\n${job.description}\n\n任职要求\n${job.jobRequire}`,
      );
      expect(normalized.job.publishedAt).toBeNull();
      expect(() => adapter.normalize({ discovered, detail: null }, ctx)).toThrow();
      await expect(
        adapter.fetchDetail({ ...discovered, externalJobId: '999' }, ctx),
      ).rejects.toThrow();
    });
  }
  it.each([
    ['complete', (p: number) => page(rows((p - 1) * 10, p === 3 ? 1 : 10), 21, p), null],
    [
      'partial',
      (p: number) => page(rows((p - 1) * 10, p === 3 ? 0 : 10), 21, p),
      'invalid_page_boundary',
    ],
    ['partial', (p: number) => page(rows(0, p === 3 ? 1 : 10), 21, p), 'duplicate_job_ids'],
    [
      'partial',
      (p: number) => page(rows((p - 1) * 10, p === 3 ? 1 : 10), p === 1 ? 21 : 22, p),
      'pagination_total_changed',
    ],
  ] as const)('checks pagination %s %s %s', async (coverage, response, reason) => {
    expect(
      (
        await collectDiscovery(
          createMihoyoAdapter('mihoyo.social').discover(context('mihoyo.social', response)),
        )
      ).completion,
    ).toMatchObject({ coverage, diagnostics: { reason } });
  });
  it.each([2, 3])('samples %s pages with first and last only', async (maximumPages) => {
    const calls: number[] = [];
    const ctx = context('mihoyo.social', (p) => {
      calls.push(p);
      return page(rows((p - 1) * 10, p === 6 ? 7 : 10), 57, p);
    });
    const result = await collectDiscovery(
      createMihoyoAdapter('mihoyo.social').discover({
        ...ctx,
        config: mihoyoConfigSchema.parse({ maximumPages, pageSampling: 'first-last' }),
      }),
    );
    expect(calls).toEqual(maximumPages === 2 ? [1, 6] : [1, 3, 6]);
    expect(result.completion).toMatchObject({
      coverage: 'partial',
      diagnostics: { reason: 'sampled_pages' },
    });
  });
  it('validates page echoes, business envelopes and recruitment boundaries', () => {
    for (const bad of [
      page([], 0, 2),
      envelope({ list: [], total: 0, pageNo: 1, pageSize: 20 }),
      { code: 0, success: false },
      '<html>verify</html>',
    ])
      expect(() => parseMihoyoPage(bad, 'mihoyo.social', 1)).toThrow();
    for (const overrides of [
      { channelDetailIds: [2] },
      { jobNatureId: 3 },
      { jobNature: '实习' },
      { id: '../x' },
    ])
      expect(() => parseMihoyoJob({ ...fixture.social, ...overrides }, 'mihoyo.social')).toThrow();
    for (const overrides of [
      { hireType: 1 },
      { id: '999' },
      { description: '' },
      { jobRequire: '' },
      { status: 0 },
    ])
      expect(() =>
        parseMihoyoDetail(
          envelope({ ...fixture.social, ...overrides }),
          'mihoyo.social',
          fixture.social.id,
        ),
      ).toThrow();
    expect(() => mihoyoUrl('mihoyo.social', '../x')).toThrow();
    expect(() => mihoyoConfigSchema.parse({ pageSize: 100 })).toThrow();
  });
  it('separates legitimate zero, health failure and first-page-only checks', async () => {
    const adapter = createMihoyoAdapter('mihoyo.social');
    const calls: number[] = [];
    const ctx = context('mihoyo.social', (p) => {
      calls.push(p);
      return page(rows(0, 10), 100, p);
    });
    expect((await adapter.healthCheck(ctx)).status).toBe('healthy');
    expect(calls).toEqual([1]);
    const zero = context('mihoyo.social', () => page([]));
    expect((await collectDiscovery(adapter.discover(zero))).completion.coverage).toBe('complete');
    expect((await adapter.healthCheck(zero)).status).toBe('degraded');
    const bad = context('mihoyo.social', () => ({
      code: -3,
      success: false,
      message: 'private upstream message',
    }));
    expect((await adapter.healthCheck(bad)).errorCategory).toBe('access_blocked');
    await expect(collectDiscovery(adapter.discover(bad))).rejects.toMatchObject({
      category: 'access_blocked',
    });
    expect(JSON.stringify(await adapter.healthCheck(bad))).not.toContain('private upstream');
  });
  it('does not retain internal fields or list summaries as detail and leaves unknown city unset', async () => {
    const job = parseMihoyoJob(
      { ...fixture.social, jobSummary: 'not a full JD', hadDelivery: 1 },
      'mihoyo.social',
    );
    expect(job).not.toHaveProperty('description');
    expect(job).not.toHaveProperty('hadDelivery');
    expect(job).not.toHaveProperty('jobSummary');
    const detail = parseMihoyoDetail(
      envelope({ ...fixture.social, addressDetailList: [], hadDelivery: 1 }),
      'mihoyo.social',
      job.id,
    );
    expect(detail).not.toHaveProperty('hadDelivery');
    const normalized = await createMihoyoAdapter('mihoyo.social').normalize(
      {
        discovered: {
          externalJobId: job.id,
          sourceUrl: mihoyoUrl('mihoyo.social', job.id),
          raw: job,
        },
        detail,
      },
      context('mihoyo.social'),
    );
    expect(normalized.job.locations).toEqual([]);
  });
});
