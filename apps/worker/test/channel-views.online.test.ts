import { parseId } from '@jobhunter/domain';
import {
  FetchSourceHttpClient,
  type DiscoverContext,
  type DiscoveryEvent,
  type JobSourceAdapter,
} from '@jobhunter/source-core';
import {
  createAlibabaAdapter,
  createByteDanceCampusAdapter,
  createDewuAdapter,
  createInlineChannelViewAdapter,
  createXiaohongshuAdapter,
  scriptedConfigSchema,
  type ScriptedConfig,
} from '@jobhunter/sources';
import { describe, expect, it } from 'vitest';
import { createPlaywrightSourcePageClient } from '../src/browser-source.js';

const online = process.env.JOBHUNTER_ONLINE_SOURCES === '1';
const selected = new Set(
  (process.env.JOBHUNTER_BROWSER_ONLINE_SOURCE ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
);

interface ChannelGate {
  readonly slug: 'alibaba-intern' | 'bytedance-intern' | 'dewu-intern' | 'xiaohongshu-intern';
  readonly companyId: string;
  readonly sourceId: string;
  readonly browser: boolean;
  readonly base: () => JobSourceAdapter<ScriptedConfig, never>;
}

const gates: readonly ChannelGate[] = [
  {
    slug: 'alibaba-intern',
    companyId: '018f0000-0000-7000-8000-000000000102',
    sourceId: '018f0000-0000-7000-8000-000000000220',
    browser: true,
    base: createAlibabaAdapter,
  },
  {
    slug: 'bytedance-intern',
    companyId: '018f0000-0000-7000-8000-000000000104',
    sourceId: '018f0000-0000-7000-8000-000000000224',
    browser: true,
    base: createByteDanceCampusAdapter,
  },
  {
    slug: 'dewu-intern',
    companyId: '018f0000-0000-7000-8000-000000000107',
    sourceId: '018f0000-0000-7000-8000-000000000228',
    browser: true,
    base: createDewuAdapter,
  },
  {
    slug: 'xiaohongshu-intern',
    companyId: '018f0000-0000-7000-8000-000000000108',
    sourceId: '018f0000-0000-7000-8000-000000000230',
    browser: false,
    base: createXiaohongshuAdapter,
  },
];

for (const gate of gates) {
  describe.skipIf(!online || !selected.has(gate.slug))(`${gate.slug} online smoke`, () => {
    it('samples the physical-list boundaries and emits only internships', async () => {
      const config = scriptedConfigSchema.parse({ pageSize: 100 });
      const context: DiscoverContext<ScriptedConfig> = {
        companyId: parseId(gate.companyId, 'Company'),
        sourceId: parseId(gate.sourceId, 'JobSource'),
        requestId: `${gate.slug}-online-${String(Date.now())}`,
        config,
        cursor: null,
        signal: AbortSignal.timeout(600_000),
        timeoutMs: 60_000,
        http: new FetchSourceHttpClient(),
        ...(gate.browser
          ? {
              page: createPlaywrightSourcePageClient({
                headless: true,
                navigationTimeoutMs: 60_000,
                maximumPages: 3,
                pageSampling: 'first-last',
              }),
            }
          : {}),
      };
      const adapter = createInlineChannelViewAdapter({
        key: gate.slug.replace('-', '.'),
        channel: 'intern',
        base: gate.base,
      });
      const jobs: Extract<DiscoveryEvent, { type: 'job' }>[] = [];
      let completion: Extract<DiscoveryEvent, { type: 'complete' }> | undefined;
      for await (const event of adapter.discover(context)) {
        if (event.type === 'job') jobs.push(event);
        if (event.type === 'complete') completion = event;
      }
      if (gate.browser) {
        if (completion?.diagnostics?.reason === 'sampled_pages') {
          expect(completion.coverage).toBe('partial');
          expect(completion.pages).toBeGreaterThanOrEqual(2);
        } else {
          expect(completion?.coverage).toBe('complete');
        }
        expect(completion?.pages).toBeLessThanOrEqual(3);
      } else {
        expect(completion?.coverage, JSON.stringify(completion?.diagnostics)).toBe('complete');
      }
      expect(jobs.length).toBeGreaterThan(0);
      expect(new Set(jobs.map(({ job }) => job.externalJobId)).size).toBe(jobs.length);
      for (const { job } of jobs) {
        const normalized = await adapter.normalize(
          { discovered: job, detail: null },
          { companyId: context.companyId, sourceId: context.sourceId, config },
        );
        expect(normalized.job.recruitmentCategory).toBe('internship');
      }
    }, 610_000);
  });
}
