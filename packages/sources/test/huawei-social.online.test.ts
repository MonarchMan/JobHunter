import { parseId } from '@jobhunter/domain';
import {
  FetchSourceHttpClient,
  type DiscoverContext,
  type DiscoveryEvent,
} from '@jobhunter/source-core';
import { describe, expect, it } from 'vitest';
import {
  createHuaweiSocialAdapter,
  huaweiSocialConfigSchema,
  type HuaweiSocialConfig,
} from '../src/index.js';

const online = process.env.JOBHUNTER_ONLINE_SOURCES === '1';
const selected = new Set(
  (process.env.JOBHUNTER_ONLINE_SOURCE ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
);

describe.skipIf(!online || !selected.has('huawei-social'))('Huawei social boundary smoke', () => {
  it('validates the first and last official pages', async () => {
    const config = huaweiSocialConfigSchema.parse({ pageSize: 2 });
    const context: DiscoverContext<HuaweiSocialConfig> = {
      companyId: parseId('018f0000-0000-7000-8000-000000000110', 'Company'),
      sourceId: parseId('018f0000-0000-7000-8000-000000000235', 'JobSource'),
      requestId: `huawei-social-${String(Date.now())}`,
      config,
      cursor: null,
      signal: AbortSignal.timeout(60_000),
      timeoutMs: 20_000,
      http: new FetchSourceHttpClient(),
    };
    const adapter = createHuaweiSocialAdapter();
    const jobs: Extract<DiscoveryEvent, { type: 'job' }>[] = [];
    let completion: Extract<DiscoveryEvent, { type: 'complete' }> | undefined;
    for await (const event of adapter.discover(context)) {
      if (event.type === 'job') jobs.push(event);
      if (event.type === 'complete') completion = event;
    }
    expect(completion?.coverage).toBe('complete');
    expect(completion?.pages).toBeGreaterThanOrEqual(2);
    expect(jobs.length).toBeGreaterThan(2);
    expect(new Set(jobs.map(({ job }) => job.externalJobId)).size).toBe(jobs.length);
    for (const { job } of jobs) {
      const normalized = await adapter.normalize(
        { discovered: job, detail: null },
        { companyId: context.companyId, sourceId: context.sourceId, config },
      );
      expect(normalized.job.recruitmentCategory).toBe('social');
      expect(normalized.job.description.length).toBeGreaterThan(0);
    }
  }, 70_000);
});
