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
  createMihoyoAdapter,
  mihoyoConfigSchema,
  mihoyoSites,
  firstPartyPhysicalSourceCatalog,
  type MihoyoKey,
  type MihoyoConfig,
} from '../src/index.js';

const enabled = process.env.JOBHUNTER_ONLINE_SOURCES === '1';
const selected = new Set((process.env.JOBHUNTER_ONLINE_SOURCE ?? '').split(','));
describe.skipIf(!enabled)('Mihoyo independent production smoke (SWT-019)', () => {
  for (const key of Object.keys(mihoyoSites) as MihoyoKey[])
    it.skipIf(!selected.has('mihoyo') && !selected.has(key))(
      `${key}: first/last and one required detail`,
      async () => {
        // 1、使用生产适配器与真实限流门，仅两页而非全量同步。
        const source = firstPartyPhysicalSourceCatalog.find((v) => v.source.adapterKey === key);
        if (!source) throw new Error('Missing Mihoyo physical source.');
        const adapter = createMihoyoAdapter(key);
        const ctx: DiscoverContext<MihoyoConfig> = {
          companyId: parseId(source.company.id, 'Company'),
          sourceId: parseId(source.source.id, 'JobSource'),
          requestId: `smoke-${key}`,
          cursor: null,
          signal: AbortSignal.timeout(60000),
          timeoutMs: 20000,
          config: mihoyoConfigSchema.parse({ maximumPages: 2, pageSampling: 'first-last' }),
          http: new FetchSourceHttpClient({
            rateLimitGate: new TokenBucketSourceRateLimitGate(
              new Map([[key, { requestsPerMinute: 12, burst: 1 }]]),
            ),
          }),
        };
        const events: DiscoveryEvent[] = [];
        const result = await collectDiscovery(
          (async function* () {
            for await (const e of adapter.discover(ctx)) {
              events.push(e);
              yield e;
            }
          })(),
        );
        const total = result.completion.diagnostics?.expectedCount;
        if (typeof total !== 'number' || total <= 0)
          throw new Error('Expected nonempty public source.');
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
        // 2、只为第一条调用真实 required 详情，身份/招聘性质/开放状态由生产解析器核验。
        const first = jobs[0];
        if (!first || !adapter.fetchDetail) throw new Error('Missing required detail.');
        const detail = await adapter.fetchDetail(first, ctx);
        const normalized = await adapter.normalize({ discovered: first, detail }, ctx);
        expect(normalized.job.recruitmentCategory).toBe(
          mihoyoSites[key].channel === 'intern' ? 'internship' : mihoyoSites[key].channel,
        );
        expect(normalized.job.description).toContain('任职要求');
        expect(normalized.job.publishedAt).toBeNull();
        console.info(
          JSON.stringify({
            at: new Date().toISOString(),
            key,
            total,
            pages: [1, last],
            sampledJobs: jobs.length,
            detailId: first.externalJobId,
            detailVerified: true,
            coverage: result.completion.coverage,
            reason: result.completion.diagnostics?.reason,
          }),
        );
      },
      65000,
    );
});
