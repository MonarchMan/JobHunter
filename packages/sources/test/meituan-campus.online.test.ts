import { parseId } from '@jobhunter/domain';
import {
  FetchSourceHttpClient,
  type DiscoverContext,
  type DiscoveryEvent,
} from '@jobhunter/source-core';
import { describe, expect, it } from 'vitest';
import {
  createMeituanCampusAdapter,
  meituanConfigSchema,
  type MeituanConfig,
} from '../src/index.js';

const online = process.env.JOBHUNTER_ONLINE_SOURCES === '1';

describe.skipIf(!online)('Meituan campus controlled online smoke', () => {
  it('discovers the complete graduate list and normalizes a live detail', async () => {
    const adapter = createMeituanCampusAdapter();
    const config: MeituanConfig = meituanConfigSchema.parse({ pageSize: 200 });
    const context: DiscoverContext<MeituanConfig> = {
      companyId: parseId('018f0000-0000-7000-8000-000000000106', 'Company'),
      sourceId: parseId('018f0000-0000-7000-8000-000000000227', 'JobSource'),
      requestId: `meituan-campus-online-${String(Date.now())}`,
      config,
      signal: AbortSignal.timeout(120_000),
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
    expect(completion?.coverage, JSON.stringify(completion?.diagnostics)).toBe('complete');
    expect(jobs.length).toBeGreaterThan(0);
    expect(new Set(jobs.map(({ job }) => job.externalJobId)).size).toBe(jobs.length);
    const first = jobs[0];
    if (!first) return;
    const detail = await adapter.fetchDetail?.(first.job, context);
    await expect(
      adapter.normalize(
        { discovered: first.job, detail: detail ?? null },
        { sourceId: context.sourceId, companyId: context.companyId, config },
      ),
    ).resolves.toMatchObject({
      job: {
        externalJobId: first.job.externalJobId,
        recruitmentCategory: 'campus',
        employmentType: '全职',
      },
    });
  }, 130_000);
});
