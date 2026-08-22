import { parseId } from '@jobhunter/domain';
import {
  FetchSourceHttpClient,
  type DiscoverContext,
  type DiscoveryEvent,
} from '@jobhunter/source-core';
import { describe, expect, it } from 'vitest';
import { baiduConfigSchema, createBaiduAdapter, type BaiduConfig } from '../src/index.js';

const online = process.env.JOBHUNTER_ONLINE_SOURCES === '1';

describe.skipIf(!online)('Baidu campus controlled online smoke', () => {
  it('discovers and normalizes internships before graduate jobs', async () => {
    const config = baiduConfigSchema.parse({ pageSize: 20 });
    const context: DiscoverContext<BaiduConfig> = {
      companyId: parseId('018f0000-0000-7000-8000-000000000103', 'Company'),
      sourceId: parseId('018f0000-0000-7000-8000-000000000203', 'JobSource'),
      requestId: `baidu-online-${String(Date.now())}`,
      config,
      signal: AbortSignal.timeout(120_000),
      timeoutMs: 20_000,
      http: new FetchSourceHttpClient(),
      cursor: null,
    };
    const jobs: Extract<DiscoveryEvent, { type: 'job' }>[] = [];
    let completion: Extract<DiscoveryEvent, { type: 'complete' }> | undefined;
    const adapter = createBaiduAdapter();
    for await (const event of adapter.discover(context)) {
      if (event.type === 'job') jobs.push(event);
      if (event.type === 'complete') completion = event;
    }
    expect(completion?.coverage).toBe('complete');
    expect(jobs.length).toBeGreaterThan(0);
    expect(new Set(jobs.map(({ job }) => job.externalJobId)).size).toBe(jobs.length);
    const first = jobs[0];
    if (!first) return;
    await expect(
      adapter.normalize(
        { discovered: first.job, detail: null },
        { sourceId: context.sourceId, companyId: context.companyId, config },
      ),
    ).resolves.toMatchObject({
      job: {
        externalJobId: first.job.externalJobId,
        employmentType: '实习',
      },
    });
  }, 130_000);
});
