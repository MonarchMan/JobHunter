import { parseId } from '@jobhunter/domain';
import {
  FetchSourceHttpClient,
  type DiscoverContext,
  type DiscoveryEvent,
} from '@jobhunter/source-core';
import { describe, expect, it } from 'vitest';
import {
  createQihoo360CampusAdapter,
  createQihoo360InternAdapter,
  qihoo360CampusConfigSchema,
  type Qihoo360CampusConfig,
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
    slug: 'qihoo360-intern',
    sourceId: '018f0000-0000-7000-8000-000000000242',
    pageSize: 50,
    category: 'internship' as const,
    factory: createQihoo360InternAdapter,
  },
  {
    slug: 'qihoo360-campus',
    sourceId: '018f0000-0000-7000-8000-000000000243',
    pageSize: 20,
    category: 'campus' as const,
    factory: createQihoo360CampusAdapter,
  },
] as const) {
  describe.skipIf(!online || !selected.has(gate.slug))(`${gate.slug} boundary smoke`, () => {
    it('validates two official boundary pages', async () => {
      const config = qihoo360CampusConfigSchema.parse({ pageSize: gate.pageSize });
      const context: DiscoverContext<Qihoo360CampusConfig> = {
        companyId: parseId('018f0000-0000-7000-8000-000000000114', 'Company'),
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
      expect(new Set(jobs.map(({ job }) => job.externalJobId)).size).toBe(jobs.length);
      for (const { job } of jobs) {
        const normalized = await adapter.normalize(
          { discovered: job, detail: null },
          { companyId: context.companyId, sourceId: context.sourceId, config },
        );
        expect(normalized.job.recruitmentCategory).toBe(gate.category);
      }
    }, 70_000);
  });
}
