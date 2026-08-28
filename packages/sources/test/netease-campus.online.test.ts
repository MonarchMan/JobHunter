import { parseId } from '@jobhunter/domain';
import {
  FetchSourceHttpClient,
  type DiscoverContext,
  type DiscoveryEvent,
} from '@jobhunter/source-core';
import { describe, expect, it } from 'vitest';
import {
  createNeteaseCampusGamesAdapter,
  createNeteaseCampusInternetAdapter,
  createNeteaseCampusLeihuoAdapter,
  neteaseCampusConfigSchema,
  type NeteaseCampusConfig,
} from '../src/index.js';

const online = process.env.JOBHUNTER_ONLINE_SOURCES === '1';
const selected = new Set(
  (process.env.JOBHUNTER_ONLINE_SOURCE ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
);

for (const gate of [
  {
    slug: 'netease-campus-internet',
    sourceId: '018f0000-0000-7000-8000-000000000245',
    factory: createNeteaseCampusInternetAdapter,
  },
  {
    slug: 'netease-campus-games',
    sourceId: '018f0000-0000-7000-8000-000000000246',
    factory: createNeteaseCampusGamesAdapter,
  },
  {
    slug: 'netease-campus-leihuo',
    sourceId: '018f0000-0000-7000-8000-000000000247',
    factory: createNeteaseCampusLeihuoAdapter,
  },
] as const) {
  describe.skipIf(!online || !selected.has(gate.slug))(`${gate.slug} boundary smoke`, () => {
    it('validates the first and last official pages', async () => {
      const config = neteaseCampusConfigSchema.parse({ pageSize: 50 });
      const context: DiscoverContext<NeteaseCampusConfig> = {
        companyId: parseId('018f0000-0000-7000-8000-000000000115', 'Company'),
        sourceId: parseId(gate.sourceId, 'JobSource'),
        requestId: `${gate.slug}-${String(Date.now())}`,
        config,
        cursor: null,
        signal: AbortSignal.timeout(60_000),
        timeoutMs: 20_000,
        http: new FetchSourceHttpClient(),
      };
      const adapter = gate.factory();
      const jobs: Extract<DiscoveryEvent, { type: 'job' }>[] = [];
      let completion: Extract<DiscoveryEvent, { type: 'complete' }> | undefined;
      for await (const event of adapter.discover(context)) {
        if (event.type === 'job') jobs.push(event);
        if (event.type === 'complete') completion = event;
      }
      expect(completion?.coverage).toBe('complete');
      expect(completion?.pages).toBe(2);
      expect(jobs.length).toBeGreaterThan(0);
      expect(new Set(jobs.map(({ job }) => job.externalJobId)).size).toBe(jobs.length);
      for (const { job } of jobs) {
        const normalized = await adapter.normalize(
          { discovered: job, detail: null },
          { companyId: context.companyId, sourceId: context.sourceId, config },
        );
        expect(normalized.job.recruitmentCategory).toBe('campus');
        expect(normalized.job.description.length).toBeGreaterThan(0);
      }
    }, 70_000);
  });
}
