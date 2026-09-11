import { parseId } from '@jobhunter/domain';
import {
  FetchSourceHttpClient,
  type DiscoverContext,
  type DiscoveryEvent,
  type SourcePageCollection,
} from '@jobhunter/source-core';
import {
  createKuaishouAdapter,
  firstPartyPhysicalSourceCatalog,
  kuaishouConfigSchema,
  kuaishouDefinitions,
  kuaishouSite,
  parseKuaishouJob,
  type KuaishouConfig,
  type KuaishouKey,
} from '@jobhunter/sources';
import { chromium } from 'playwright';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  createPlaywrightSourcePageClient,
  resolveBrowserExecutablePath,
} from '../src/browser-source.js';

const enabled = process.env.JOBHUNTER_ONLINE_SOURCES === '1';
const selected = new Set((process.env.JOBHUNTER_ONLINE_SOURCE ?? '').split(','));

describe.skipIf(!enabled)('Kuaishou independent production boundary smoke (SWT-009)', () => {
  for (const key of Object.keys(kuaishouDefinitions) as KuaishouKey[]) {
    it.skipIf(!selected.has('kuaishou') && !selected.has(key))(
      `${key}: first/last, normalization and independent official detail`,
      async () => {
        // 1、每个物理来源新建独立匿名生产会话，不读取全站，只采两端。
        const adapter = createKuaishouAdapter(key);
        const seed = firstPartyPhysicalSourceCatalog.find(
          (record) => record.source.adapterKey === key,
        );
        if (!seed) throw new Error('Physical source must be registered.');
        const config = kuaishouConfigSchema.parse({});
        const page = createPlaywrightSourcePageClient({
          maximumPages: 2,
          pageSampling: 'first-last',
        });
        const collect = page.collect;
        if (!collect) throw new Error('Browser collection is required.');
        let captured: SourcePageCollection | undefined;
        const context: DiscoverContext<KuaishouConfig> = {
          companyId: parseId('018f0000-0000-7000-8000-000000000116', 'Company'),
          sourceId: parseId(seed.source.id, 'JobSource'),
          requestId: `kuaishou-${key}-${String(Date.now())}`,
          config,
          cursor: null,
          signal: AbortSignal.timeout(90_000),
          timeoutMs: 30_000,
          http: new FetchSourceHttpClient(),
          page: {
            snapshot: page.snapshot.bind(page),
            collect: async (request) => {
              expect(request.pageSize).toBe(50);
              captured = await collect(request);
              return captured;
            },
          },
        };
        const jobs: Extract<DiscoveryEvent, { type: 'job' }>[] = [];
        let completion: Extract<DiscoveryEvent, { type: 'complete' }> | undefined;
        for await (const event of adapter.discover(context)) {
          if (event.type === 'job') jobs.push(event);
          if (event.type === 'complete') completion = event;
        }
        const total = completion?.diagnostics?.expectedCount;
        if (!captured || !jobs[0] || typeof total !== 'number' || total <= 0)
          throw new Error('Expected independently verified official jobs.');
        const last = Math.ceil(total / config.pageSize);
        expect(captured.pages.map((p) => p.page)).toEqual([...new Set([1, last])]);
        expect(completion?.diagnostics).toMatchObject({ duplicateIds: 0, totalChanged: false });
        if (last > 2)
          expect(completion).toMatchObject({
            coverage: 'partial',
            diagnostics: { reason: 'sampled_pages' },
          });
        for (const item of captured.pages)
          expect(item.records.length).toBe(
            Math.min(config.pageSize, total - (item.page - 1) * config.pageSize),
          );
        // 2、所有样本走生产 normalize；性质、地点、职责要求与稳定 ID 必须有效。
        const site = kuaishouSite(key);
        for (const { job } of jobs) {
          const normalized = await adapter.normalize({ discovered: job, detail: null }, context);
          expect(normalized.job.recruitmentCategory).toBe(
            site.channel === 'intern' ? 'internship' : site.channel,
          );
          expect(normalized.job.description).toContain('工作职责');
          expect(normalized.job.description).toContain('工作要求');
          expect(normalized.job.locations.length).toBeGreaterThan(0);
          expect(normalized.job.detailUrl).toBe(`${site.detail}${job.externalJobId}`);
        }
        // 3、独立打开一条官方详情，比较 ID、标题和两段正文，不借用另一渠道的成功结果。
        const first = jobs[0].job;
        const browser = await chromium.launch({
          headless: true,
          executablePath: resolveBrowserExecutablePath(),
        });
        try {
          const detailPage = await browser.newPage();
          const path = site.campus
            ? '/recruit/campus/e/api/v1/open/positions/find'
            : '/recruit/e/api/v1/open/position';
          const [response] = await Promise.all([
            detailPage.waitForResponse((r) => new URL(r.url()).pathname === path, {
              timeout: 30_000,
            }),
            detailPage.goto(first.sourceUrl, { waitUntil: 'domcontentloaded' }),
          ]);
          expect(response.status()).toBe(200);
          const body = z
            .object({
              code: z.literal(0),
              result: z.object({
                id: z.number(),
                name: z.string().trim(),
                description: z.string().trim(),
                positionDemand: z.string().trim(),
              }),
            })
            .parse(await response.json());
          const raw = parseKuaishouJob(first.raw, key);
          expect(String(body.result.id)).toBe(first.externalJobId);
          expect(body.result).toMatchObject({
            name: raw.name,
            description: raw.description,
            positionDemand: raw.positionDemand,
          });
        } finally {
          await browser.close();
        }
        console.info(
          JSON.stringify({
            at: new Date().toISOString(),
            adapter: key,
            total,
            pages: captured.pages.map((p) => p.page),
            lengths: captured.pages.map((p) => p.records.length),
            detailId: first.externalJobId,
            coverage: completion?.coverage,
            reason: completion?.diagnostics?.reason,
          }),
        );
      },
      120_000,
    );
  }
});
