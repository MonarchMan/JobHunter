import { parseId } from '@jobhunter/domain';
import {
  FetchSourceHttpClient,
  type DiscoverContext,
  type DiscoveryEvent,
} from '@jobhunter/source-core';
import { describe, expect, it } from 'vitest';
import { baiduConfigSchema, createBaiduSocialAdapter, type BaiduConfig } from '../src/index.js';

const online = process.env.JOBHUNTER_ONLINE_SOURCES === '1';

describe.skipIf(!online)('Baidu social controlled online smoke', () => {
  it('discovers and normalizes the complete anonymous social list', async () => {
    const adapter = createBaiduSocialAdapter();
    const config: BaiduConfig = baiduConfigSchema.parse({ pageSize: 20 });
    const context: DiscoverContext<BaiduConfig> = {
      companyId: parseId('018f0000-0000-7000-8000-000000000103', 'Company'),
      sourceId: parseId('018f0000-0000-7000-8000-000000000223', 'JobSource'),
      requestId: `baidu-social-online-${String(Date.now())}`,
      config,
      signal: AbortSignal.timeout(180_000),
      timeoutMs: 20_000,
      http: new FetchSourceHttpClient(),
      cursor: null,
    };
    const jobs: Extract<DiscoveryEvent, { type: 'job' }>[] = [];
    let completion: Extract<DiscoveryEvent, { type: 'complete' }> | undefined;
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
        recruitmentCategory: 'social',
        employmentType: '全职',
      },
    });
  }, 190_000);
});
