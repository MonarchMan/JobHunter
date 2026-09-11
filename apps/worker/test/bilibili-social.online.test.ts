import { parseId } from '@jobhunter/domain';
import {
  FetchSourceHttpClient,
  type DiscoverContext,
  type DiscoveryEvent,
  type SourcePageCollection,
} from '@jobhunter/source-core';
import {
  bilibiliSocialConfigSchema,
  createBilibiliSocialAdapter,
  parseBilibiliSocialJob,
  type BilibiliSocialConfig,
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

describe.skipIf(!enabled || !selected.has('bilibili-social'))(
  'Bilibili production adapter boundary smoke (SWT-007)',
  () => {
    it('normalizes first/last through the real browser driver and verifies one official detail', async () => {
      // 1、按生产默认容量重放首页，最多取两页边界；UI 初始化额外产生一条首页请求。
      const config = bilibiliSocialConfigSchema.parse({});
      const page = createPlaywrightSourcePageClient({
        maximumPages: 2,
        pageSampling: 'first-last',
      });
      const collect = page.collect;
      if (!collect) throw new Error('Browser collection is required.');
      let captured: SourcePageCollection | undefined;
      const context: DiscoverContext<BilibiliSocialConfig> = {
        companyId: parseId('018f0000-0000-7000-8000-000000000117', 'Company'),
        sourceId: parseId('018f0000-0000-7000-8000-000000000249', 'JobSource'),
        requestId: `bilibili-adapter-${String(Date.now())}`,
        config,
        cursor: null,
        signal: AbortSignal.timeout(90_000),
        timeoutMs: 30_000,
        http: new FetchSourceHttpClient(),
        page: {
          snapshot: page.snapshot.bind(page),
          collect: async (request) => {
            expect(request.pageSize).toBe(50);
            expect(request.minimumRequestIntervalMs).toBe(5000);
            captured = await collect(request);
            return captured;
          },
        },
      };
      const adapter = createBilibiliSocialAdapter();
      const jobs: Extract<DiscoveryEvent, { type: 'job' }>[] = [];
      let completion: Extract<DiscoveryEvent, { type: 'complete' }> | undefined;
      for await (const event of adapter.discover(context)) {
        if (event.type === 'job') jobs.push(event);
        if (event.type === 'complete') completion = event;
      }
      if (!captured || !completion || !jobs[0])
        throw new Error('Expected real jobs and completion.');
      const total = completion.diagnostics?.expectedCount;
      if (typeof total !== 'number' || total <= 0)
        throw new Error('Expected positive official total.');
      const lastPage = Math.ceil(total / config.pageSize);
      expect(captured.pages.map((item) => item.page)).toEqual([...new Set([1, lastPage])]);
      expect(completion.diagnostics).toMatchObject({ duplicateIds: 0, totalChanged: false });
      if (lastPage > 2)
        expect(completion).toMatchObject({
          coverage: 'partial',
          diagnostics: { reason: 'sampled_pages' },
        });
      for (const item of captured.pages) {
        expect(item.total).toBe(total);
        expect(item.records).toHaveLength(
          Math.min(config.pageSize, total - (item.page - 1) * config.pageSize),
        );
      }
      // 2、每条样本都通过生产归一化，验证类别、纯文本、日期与官方深链。
      expect(new Set(jobs.map((item) => item.job.externalJobId)).size).toBe(jobs.length);
      for (const { job } of jobs) {
        const normalized = await adapter.normalize({ discovered: job, detail: null }, context);
        expect(normalized.job.recruitmentCategory).toBe('social');
        expect(normalized.job.description).toContain('工作职责');
        expect(normalized.job.description).toContain('工作要求');
        expect(normalized.job.description).not.toMatch(/<\/?(?:strong|p|br)\b/i);
        expect(normalized.job.locations.length).toBeGreaterThan(0);
        expect(normalized.job.detailUrl).toBe(
          `https://jobs.bilibili.com/social/positions/${job.externalJobId}`,
        );
      }
      // 3、只打开一条独立官方详情验证 inline 正文身份；无需登录或投递简历。
      const first = jobs[0].job;
      const browser = await chromium.launch({
        headless: true,
        executablePath: resolveBrowserExecutablePath(),
      });
      try {
        const detailPage = await browser.newPage();
        const [response] = await Promise.all([
          detailPage.waitForResponse(
            (r) => new URL(r.url()).pathname === `/api/srs/position/detail/${first.externalJobId}`,
            { timeout: 30_000 },
          ),
          detailPage.goto(first.sourceUrl, { waitUntil: 'domcontentloaded' }),
        ]);
        expect(response.status()).toBe(200);
        const body = z
          .object({ code: z.literal(0), data: z.unknown() })
          .parse(await response.json());
        const detail = parseBilibiliSocialJob(body.data);
        expect(detail.id).toBe(first.externalJobId);
        expect(detail.positionName).toBe(parseBilibiliSocialJob(first.raw).positionName);
        const normalized = await adapter.normalize(
          { discovered: { ...first, raw: detail }, detail: null },
          context,
        );
        expect(normalized.job.description).toContain('工作要求');
      } finally {
        await browser.close();
      }
      console.info(
        JSON.stringify({
          at: new Date().toISOString(),
          adapter: adapter.metadata.key,
          total,
          pages: captured.pages.map((item) => item.page),
          lengths: captured.pages.map((item) => item.records.length),
          sampleCount: jobs.length,
          detailId: first.externalJobId,
          coverage: completion.coverage,
          reason: completion.diagnostics?.reason,
        }),
      );
    }, 120_000);
  },
);
