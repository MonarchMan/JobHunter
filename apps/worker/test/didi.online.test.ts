import { parseId } from '@jobhunter/domain';
import {
  collectDiscovery,
  FetchSourceHttpClient,
  TokenBucketSourceRateLimitGate,
  type DiscoverContext,
  type SourcePageCollection,
  type DiscoveryEvent,
} from '@jobhunter/source-core';
import {
  createDidiAdapter,
  didiSites,
  didiConfigSchema,
  parseDidiJob,
  type DidiKey,
  type DidiConfig,
  firstPartyPhysicalSourceCatalog,
} from '@jobhunter/sources';
import { describe, it, expect } from 'vitest';
import { createPlaywrightSourcePageClient } from '../src/browser-source.js';

const enabled = process.env.JOBHUNTER_ONLINE_SOURCES === '1';
const selected = new Set((process.env.JOBHUNTER_ONLINE_SOURCE ?? '').split(','));
describe.skipIf(!enabled)('Didi independent production boundary smoke (SWT-013, SWT-014)', () => {
  for (const key of Object.keys(didiSites) as DidiKey[])
    it.skipIf(!selected.has('didi') && !selected.has(key))(
      `${key}: first/last and one detail`,
      async () => {
        // 1、生产适配器以显式采样配置运行，两页之外不遍历，匿名来源限流保持每分钟 12 次。
        const site = didiSites[key];
        const adapter = createDidiAdapter(key);
        const catalog = firstPartyPhysicalSourceCatalog.find((v) => v.source.adapterKey === key);
        if (!catalog) throw new Error('Didi physical source is not registered.');
        const config = didiConfigSchema(key).parse({ maximumPages: 2, pageSampling: 'first-last' });
        const browser = createPlaywrightSourcePageClient();
        let captured: SourcePageCollection | undefined;
        const context: DiscoverContext<DidiConfig> = {
          companyId: parseId('018f0000-0000-7000-8000-000000000118', 'Company'),
          sourceId: parseId(catalog.source.id, 'JobSource'),
          requestId: `didi-${key}`,
          config,
          cursor: null,
          signal: AbortSignal.timeout(120000),
          timeoutMs: 30000,
          http: new FetchSourceHttpClient({
            rateLimitGate: new TokenBucketSourceRateLimitGate(
              new Map([[key, { requestsPerMinute: 12, burst: 1 }]]),
            ),
          }),
          page: {
            snapshot: browser.snapshot.bind(browser),
            collect: async (request) => {
              if (!browser.collect) throw new Error('Browser required.');
              const result = await browser.collect(request);
              if (request.responseShape === 'didi-moka') captured = result;
              return result;
            },
          },
        };
        const events: DiscoveryEvent[] = [];
        const observed = (async function* (): AsyncIterable<DiscoveryEvent> {
          for await (const event of adapter.discover(context)) {
            events.push(event);
            yield event;
          }
        })();
        const summary = await collectDiscovery(observed);
        const result = {
          ...summary,
          events,
          jobs: events.flatMap((event) => (event.type === 'job' ? [event.job] : [])),
        };
        const total = captured?.pages[0]?.total ?? result.completion.diagnostics?.expectedCount;
        if (key === 'didi.campus.elite' && total === 0) {
          expect(result.completion).toMatchObject({
            coverage: 'complete',
            discoveredCount: 0,
            pages: 1,
          });
          console.info(
            JSON.stringify({
              at: new Date().toISOString(),
              key,
              total,
              coverage: 'complete',
              detailVerified: false,
              supportStatus: 'experimental',
            }),
          );
          return;
        }
        if (typeof total !== 'number' || total <= 0 || !result.jobs[0])
          throw new Error('Expected verified public jobs.');
        const last = Math.ceil(total / config.pageSize);
        const pages = result.events.filter((e) => e.type === 'page').map((e) => e.page);
        expect(pages).toEqual([...new Set([1, last])]);
        expect(result.completion.diagnostics).toMatchObject({
          duplicateIds: 0,
          totalChanged: false,
        });
        const boundaryFailure = result.completion.diagnostics?.reason === 'invalid_page_boundary';
        // 社招已获用户验收为 supported，但上游短页仍必须安全降级，不能冒充完整采集。
        if (boundaryFailure && key === 'didi.social') {
          expect(result.completion.coverage).toBe('partial');
          expect(result.completion.diagnostics?.reason).toBe('invalid_page_boundary');
        } else if (last > 2)
          expect(result.completion).toMatchObject({
            coverage: 'partial',
            diagnostics: { reason: 'sampled_pages' },
          });
        const paused =
          captured?.pages
            .flatMap((p) => p.records)
            .filter((v) => parseDidiJob(v, key).status === 'pause').length ?? 0;
        if (!boundaryFailure)
          expect(result.jobs.length + paused).toBe(
            last === 1 ? total : config.pageSize + (total - (last - 1) * config.pageSize),
          );
        for (const job of result.jobs) {
          const raw = parseDidiJob(job.raw, key);
          expect(raw.channel).toBe(site.channel);
          expect(raw.status).toBe('open');
          expect(job.sourceUrl).toBe(`${site.detail}${raw.id}`);
        }
        // 2、只补一条延迟详情；校园正文内联全部归一化，并额外独立请求一条详情核对。
        const first = result.jobs[0];
        let detail = adapter.fetchDetail ? await adapter.fetchDetail(first, context) : null;
        if (site.channel === 'campus') {
          if (!browser.collect) throw new Error('Browser required.');
          const collection = await browser.collect({
            sourceKey: key,
            requestId: 'didi-detail-smoke',
            url: first.sourceUrl,
            allowedHosts: [site.host],
            signal: context.signal,
            timeoutMs: 30000,
            maximumPages: 1,
            maximumResponseBytes: 2 * 1024 * 1024,
            pageSize: 30,
            listEndpointPath: '/api/outer/ats-apply/website/job',
            responseShape: 'didi-moka-detail',
          });
          detail = parseDidiJob(collection.pages[0]?.records[0], key);
          expect(detail.id).toBe(first.externalJobId);
          expect(detail.description).toBe(parseDidiJob(first.raw, key).description);
          for (const job of result.jobs)
            expect(
              (await adapter.normalize({ discovered: job, detail: null }, context)).job.description
                .length,
            ).toBeGreaterThan(20);
        }
        const normalized = await adapter.normalize({ discovered: first, detail }, context);
        expect(normalized.job.description.length).toBeGreaterThan(20);
        expect(normalized.job.recruitmentCategory).toBe(
          site.channel === 'intern' ? 'internship' : site.channel,
        );
        console.info(
          JSON.stringify({
            at: new Date().toISOString(),
            key,
            total,
            pages,
            lengths: captured?.pages.map((p) => p.records.length),
            samples: result.jobs.length,
            paused,
            paginationBoundaryPassed: !boundaryFailure,
            catalogSupportStatus: catalog.source.supportStatus,
            detailId: first.externalJobId,
            coverage: result.completion.coverage,
            reason: result.completion.diagnostics?.reason,
          }),
        );
      },
      150000,
    );
});
