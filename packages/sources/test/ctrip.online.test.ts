import { parseId } from '@jobhunter/domain';
import {
  collectDiscovery,
  FetchSourceHttpClient,
  TokenBucketSourceRateLimitGate,
  type DiscoveryEvent,
  type DiscoverContext,
} from '@jobhunter/source-core';
import { describe, it, expect } from 'vitest';
import {
  createCtripAdapter,
  ctripConfigSchema,
  ctripSites,
  ctripRequest,
  parseCtripDetail,
  parseCtripJob,
  firstPartyPhysicalSourceCatalog,
  type CtripKey,
  type CtripConfig,
} from '../src/index.js';

const enabled = process.env.JOBHUNTER_ONLINE_SOURCES === '1';
const selected = new Set((process.env.JOBHUNTER_ONLINE_SOURCE ?? '').split(','));
describe.skipIf(!enabled)('Ctrip independent bounded production smoke (SWT-018)', () => {
  for (const key of Object.keys(ctripSites) as CtripKey[])
    it.skipIf(!selected.has('ctrip') && !selected.has(key))(
      `${key}: first/last plus one detail`,
      async () => {
        // 1、生产适配器最多两页，不进行完整同步；请求由实际限流门串行执行。
        const source = firstPartyPhysicalSourceCatalog.find((v) => v.source.adapterKey === key);
        if (!source) throw new Error('Missing Ctrip source.');
        const adapter = createCtripAdapter(key);
        const ctx: DiscoverContext<CtripConfig> = {
          companyId: parseId(source.company.id, 'Company'),
          sourceId: parseId(source.source.id, 'JobSource'),
          requestId: `smoke-${key}`,
          cursor: null,
          signal: AbortSignal.timeout(60000),
          timeoutMs: 20000,
          config: ctripConfigSchema.parse({ maximumPages: 2, pageSampling: 'first-last' }),
          http: new FetchSourceHttpClient({
            rateLimitGate: new TokenBucketSourceRateLimitGate(
              new Map([[key, { requestsPerMinute: 12, burst: 1 }]]),
            ),
          }),
        };
        const events: DiscoveryEvent[] = [];
        const result = await collectDiscovery(
          (async function* () {
            for await (const event of adapter.discover(ctx)) {
              events.push(event);
              yield event;
            }
          })(),
        );
        const total = result.completion.diagnostics?.expectedCount;
        if (typeof total !== 'number' || total <= 0) throw new Error('Expected public jobs.');
        const last = Math.ceil(total / 10);
        expect(events.filter((e) => e.type === 'page').map((e) => e.page)).toEqual([
          ...new Set([1, last]),
        ]);
        expect(result.completion).toMatchObject({
          coverage: last > 2 ? 'partial' : 'complete',
          diagnostics: {
            reason: last > 2 ? 'sampled_pages' : null,
            duplicateIds: 0,
            totalChanged: false,
          },
        });
        const jobs = events.flatMap((e) => (e.type === 'job' ? [e.job] : []));
        expect(jobs).toHaveLength(last === 1 ? total : 10 + total - (last - 1) * 10);
        // 2、所有采样记录通过生产归一化，再独立读取一条 MJ 编号详情。
        for (const job of jobs) {
          const normalized = await adapter.normalize({ discovered: job, detail: null }, ctx);
          expect(normalized.job.description.length).toBeGreaterThan(0);
          expect(normalized.job.recruitmentCategory).toBe(
            ctripSites[key].channel === 'intern' ? 'internship' : ctripSites[key].channel,
          );
        }
        const first = jobs[0];
        if (!first) throw new Error('Missing first job.');
        const detail = parseCtripDetail(
          (await ctx.http.request(ctripRequest(key, ctx, 1, first.externalJobId))).body,
          key,
          first.externalJobId,
        );
        const normalized = await adapter.normalize(
          { discovered: { ...first, raw: detail }, detail: null },
          ctx,
        );
        expect(normalized.job.locations).toEqual(
          detail.cityName?.trim() ? [detail.cityName.trim()] : [],
        );
        // 语言偏好必须产生中文地点，但不假设动态首职位永远位于上海。
        expect(
          jobs.some((job) => /[\u4e00-\u9fff]/.test(parseCtripJob(job.raw, key).cityName ?? '')),
        ).toBe(true);
        console.info(
          JSON.stringify({
            at: new Date().toISOString(),
            key,
            total,
            pages: [1, last],
            sampledJobs: jobs.length,
            detailId: detail.fromId,
            detailVerified: true,
            coverage: result.completion.coverage,
            reason: result.completion.diagnostics?.reason,
          }),
        );
      },
      65000,
    );
});
