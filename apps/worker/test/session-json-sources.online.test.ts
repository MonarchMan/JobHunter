import { parseId } from '@jobhunter/domain';
import {
  FetchSourceHttpClient,
  type DiscoverContext,
  type DiscoveryEvent,
  type JobSourceAdapter,
} from '@jobhunter/source-core';
import {
  createNeteaseInternAdapter,
  createNeteaseSocialAdapter,
  createXiaomiCampusAdapter,
  createXiaomiInternAdapter,
  createXiaomiSocialAdapter,
  neteaseConfigSchema,
  xiaomiInternConfigSchema,
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

interface SessionGate<TConfig> {
  readonly slug:
    'xiaomi-intern' | 'xiaomi-campus' | 'xiaomi-social' | 'netease-intern' | 'netease-social';
  readonly companyId: string;
  readonly sourceId: string;
  readonly config: TConfig;
  readonly category: 'internship' | 'campus' | 'social';
  readonly factory: () => JobSourceAdapter<TConfig, never>;
}

function defineGate<TConfig>(gate: SessionGate<TConfig>): void {
  describe.skipIf(!online || !selected.has(gate.slug))(`${gate.slug} browser smoke`, () => {
    it('validates the first, middle, and last anonymous JSON pages', async () => {
      const context: DiscoverContext<TConfig> = {
        companyId: parseId(gate.companyId, 'Company'),
        sourceId: parseId(gate.sourceId, 'JobSource'),
        requestId: `${gate.slug}-browser-${String(Date.now())}`,
        config: gate.config,
        cursor: null,
        signal: AbortSignal.timeout(180_000),
        timeoutMs: 60_000,
        http: new FetchSourceHttpClient(),
        page: createPlaywrightSourcePageClient({
          headless: true,
          navigationTimeoutMs: 60_000,
          maximumPages: 3,
          pageSampling: 'first-last',
        }),
      };
      const adapter = gate.factory();
      const jobs: Extract<DiscoveryEvent, { type: 'job' }>[] = [];
      let completion: Extract<DiscoveryEvent, { type: 'complete' }> | undefined;
      for await (const event of adapter.discover(context)) {
        if (event.type === 'job') jobs.push(event);
        if (event.type === 'complete') completion = event;
      }
      if (completion?.diagnostics?.reason === 'sampled_pages') {
        expect(completion.coverage).toBe('partial');
        expect(completion.pages).toBeGreaterThanOrEqual(2);
      } else {
        expect(completion?.coverage).toBe('complete');
      }
      expect(completion?.pages).toBeLessThanOrEqual(3);
      expect(jobs.length).toBeGreaterThan(0);
      expect(new Set(jobs.map(({ job }) => job.externalJobId)).size).toBe(jobs.length);
      for (const { job } of jobs) {
        const normalized = await adapter.normalize(
          { discovered: job, detail: null },
          { companyId: context.companyId, sourceId: context.sourceId, config: gate.config },
        );
        expect(normalized.job.recruitmentCategory).toBe(gate.category);
        expect(normalized.job.description.length).toBeGreaterThan(0);
      }
    }, 190_000);
  });
}

defineGate({
  slug: 'xiaomi-intern',
  companyId: '018f0000-0000-7000-8000-000000000111',
  sourceId: '018f0000-0000-7000-8000-000000000214',
  config: xiaomiInternConfigSchema.parse({ pageSize: 100 }),
  category: 'internship',
  factory: createXiaomiInternAdapter,
});

defineGate({
  slug: 'xiaomi-campus',
  companyId: '018f0000-0000-7000-8000-000000000111',
  sourceId: '018f0000-0000-7000-8000-000000000236',
  config: xiaomiInternConfigSchema.parse({ pageSize: 100 }),
  category: 'campus',
  factory: createXiaomiCampusAdapter,
});

defineGate({
  slug: 'xiaomi-social',
  companyId: '018f0000-0000-7000-8000-000000000111',
  sourceId: '018f0000-0000-7000-8000-000000000237',
  config: xiaomiInternConfigSchema.parse({ pageSize: 100 }),
  category: 'social',
  factory: createXiaomiSocialAdapter,
});

defineGate({
  slug: 'netease-intern',
  companyId: '018f0000-0000-7000-8000-000000000115',
  sourceId: '018f0000-0000-7000-8000-000000000244',
  config: neteaseConfigSchema.parse({ pageSize: 100 }),
  category: 'internship',
  factory: createNeteaseInternAdapter,
});

defineGate({
  slug: 'netease-social',
  companyId: '018f0000-0000-7000-8000-000000000115',
  sourceId: '018f0000-0000-7000-8000-000000000245',
  config: neteaseConfigSchema.parse({ pageSize: 100 }),
  category: 'social',
  factory: createNeteaseSocialAdapter,
});
