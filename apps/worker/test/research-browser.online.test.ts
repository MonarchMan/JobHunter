import { createCommunityResearchCollectionPlan } from '@jobhunter/application';
import type { ExperienceResearchBrief } from '@jobhunter/domain';
import { describe, expect, it } from 'vitest';
import { startResearchBrowserGateway } from '../src/research-browser-gateway.js';

const online = process.env.JOBHUNTER_ONLINE_RESEARCH_BROWSER === '1';
const nowcoderCoverageOnline = process.env.JOBHUNTER_ONLINE_NOWCODER_COVERAGE === '1';

/** 构造测试输入或执行断言的辅助逻辑。 */
function boundedDiagnosticTrace(
  trace: ReturnType<Awaited<ReturnType<typeof startResearchBrowserGateway>>['readTrace']>,
): readonly Readonly<Record<string, unknown>>[] {
  return trace.map((entry) =>
    Object.fromEntries(Object.entries(entry).filter(([key]) => key !== 'bodyText')),
  );
}

describe.skipIf(!online)('restricted research browser online smoke', () => {
  it('searches, opens and reads one anonymous public interview page', async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, 120_000);
    const gateway = await startResearchBrowserGateway({
      signal: controller.signal,
      limits: {
        maximumSearches: 2,
        maximumPages: 4,
        maximumReadCalls: 4,
        maximumPageCharacters: 20_000,
        maximumTotalCharacters: 40_000,
        navigationTimeoutMs: 30_000,
      },
    });
    try {
      const pages = await gateway.collectPages(
        ['大模型算法 面经 面试 技术问题', '大模型应用开发 面经 面试 技术问题'],
        1,
        ['大模型算法', '大模型应用开发', '大模型'],
        0,
      );

      const diagnosticTrace = boundedDiagnosticTrace(gateway.readTrace());
      expect(
        pages,
        `No relevant page was collected. Trace: ${JSON.stringify(diagnosticTrace)}`,
      ).not.toHaveLength(0);
      expect(pages[0]?.finalUrl).toMatch(/^https?:\/\//u);
      expect(pages[0]?.bodyText.length).toBeGreaterThanOrEqual(300);
      expect(pages[0]?.bodySha256).toMatch(/^[0-9a-f]{64}$/u);
      expect(gateway.readTrace().some((entry) => entry.tool === 'readPage' && entry.ok)).toBe(true);
    } finally {
      clearTimeout(timeout);
      await gateway.close();
    }
  }, 130_000);
});

describe.skipIf(!nowcoderCoverageOnline)('Nowcoder interview-source coverage', () => {
  it('collects four distinct high-quality pages with both target-role directions represented', async () => {
    const brief: ExperienceResearchBrief = {
      targetRoles: ['大模型算法', '大模型应用开发'],
      companies: [],
      locations: ['中国'],
      levels: [],
      stages: ['技术面'],
      dateFrom: null,
      dateTo: null,
      language: 'zh-CN',
      maxSources: 4,
      maxQuestionsPerSource: 20,
      allowedDomains: ['nowcoder.com'],
      blockedDomains: [],
    };
    const plan = createCommunityResearchCollectionPlan(brief, 4);
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, 300_000);
    const gateway = await startResearchBrowserGateway({
      signal: controller.signal,
      allowedDomains: brief.allowedDomains,
      blockedDomains: brief.blockedDomains,
      limits: {
        maximumSearches: 4,
        maximumPages: 12,
        maximumReadCalls: 12,
        maximumPageCharacters: 40_000,
        maximumTotalCharacters: 240_000,
        navigationTimeoutMs: 20_000,
      },
    });
    try {
      const pages = await gateway.collectPages(
        plan.queries,
        brief.maxSources,
        plan.relevanceTerms,
        plan.priorityQueryCount,
      );
      const trace = boundedDiagnosticTrace(gateway.readTrace());
      const diagnostic = JSON.stringify({
        queries: plan.queries,
        collected: pages.map((page) => ({
          query: page.query,
          url: page.finalUrl,
          bodyLength: page.bodyLength,
        })),
        trace,
      });
      const contentIdentities = pages.map((page) => {
        const url = new URL(page.finalUrl);
        return `${url.hostname.toLowerCase()}${url.pathname}`;
      });
      const algorithmPages = pages.filter((page) => page.query.includes('大模型算法'));
      const applicationPages = pages.filter((page) => page.query.includes('大模型应用开发'));

      expect(
        pages.length,
        `Nowcoder coverage is below four pages. ${diagnostic}`,
      ).toBeGreaterThanOrEqual(4);
      expect(
        new Set(contentIdentities).size,
        `Tracking variants did not produce four distinct Nowcoder content pages. ${diagnostic}`,
      ).toBeGreaterThanOrEqual(4);
      expect(
        algorithmPages.length,
        `Large-model algorithm coverage is below two pages. ${diagnostic}`,
      ).toBeGreaterThanOrEqual(2);
      expect(
        applicationPages.length,
        `Large-model application coverage is below two pages. ${diagnostic}`,
      ).toBeGreaterThanOrEqual(2);
      expect(
        pages.every((page) => {
          const hostname = new URL(page.finalUrl).hostname.toLowerCase();
          return hostname === 'nowcoder.com' || hostname.endsWith('.nowcoder.com');
        }),
      ).toBe(true);
      expect(pages.every((page) => page.bodyLength >= 300)).toBe(true);
      expect(pages.every((page) => /^[0-9a-f]{64}$/u.test(page.bodySha256))).toBe(true);
    } finally {
      clearTimeout(timeout);
      await gateway.close();
    }
  }, 310_000);
});
