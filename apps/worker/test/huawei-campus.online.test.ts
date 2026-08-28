import { parseId } from '@jobhunter/domain';
import {
  FetchSourceHttpClient,
  type DiscoverContext,
  type DiscoveryEvent,
} from '@jobhunter/source-core';
import {
  createHuaweiCampusAdapter,
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

describe.skipIf(!online || !selected.has('huawei-campus'))('Huawei campus browser smoke', () => {
  it('validates the first, middle, and last official JSON pages', async () => {
    const config = scriptedConfigSchema.parse({ pageSize: 100, recruitmentType: [] });
    const context: DiscoverContext<ScriptedConfig> = {
      companyId: parseId('018f0000-0000-7000-8000-000000000110', 'Company'),
      sourceId: parseId('018f0000-0000-7000-8000-000000000234', 'JobSource'),
      requestId: `huawei-campus-${String(Date.now())}`,
      config,
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
    const adapter = createHuaweiCampusAdapter();
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
        { companyId: context.companyId, sourceId: context.sourceId, config },
      );
      expect(normalized.job.recruitmentCategory).toBe('campus');
    }
  }, 190_000);
});
