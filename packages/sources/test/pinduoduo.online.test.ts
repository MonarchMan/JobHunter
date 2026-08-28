import { parseId } from '@jobhunter/domain';
import {
  FetchSourceHttpClient,
  type DiscoverContext,
  type DiscoveryEvent,
} from '@jobhunter/source-core';
import { describe, expect, it } from 'vitest';
import {
  createPinduoduoCampusAdapter,
  pinduoduoConfigSchema,
  type PinduoduoConfig,
} from '../src/index.js';

const online = process.env.JOBHUNTER_ONLINE_SOURCES === '1';
const selected = new Set(
  (process.env.JOBHUNTER_ONLINE_SOURCE ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
);

describe.skipIf(!online || !selected.has('pinduoduo-campus'))(
  'Pinduoduo campus boundary smoke',
  () => {
    it('validates the first and last anonymous pages', async () => {
      const config = pinduoduoConfigSchema.parse({ pageSize: 10 });
      const context: DiscoverContext<PinduoduoConfig> = {
        companyId: parseId('018f0000-0000-7000-8000-000000000105', 'Company'),
        sourceId: parseId('018f0000-0000-7000-8000-000000000225', 'JobSource'),
        requestId: `pinduoduo-online-${String(Date.now())}`,
        config,
        signal: AbortSignal.timeout(30_000),
        timeoutMs: 20_000,
        http: new FetchSourceHttpClient(),
        cursor: null,
      };
      const jobs: Extract<DiscoveryEvent, { type: 'job' }>[] = [];
      let completion: Extract<DiscoveryEvent, { type: 'complete' }> | undefined;
      const adapter = createPinduoduoCampusAdapter();
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
      }
    }, 40_000);
  },
);
