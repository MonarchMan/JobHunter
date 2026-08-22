import { parseId } from '@jobhunter/domain';
import {
  FetchSourceHttpClient,
  type DiscoverContext,
  type DiscoveryEvent,
} from '@jobhunter/source-core';
import { describe, expect, it } from 'vitest';
import {
  createXiaohongshuAdapter,
  scriptedConfigSchema,
  type ScriptedConfig,
} from '../src/index.js';

const online = process.env.JOBHUNTER_ONLINE_SOURCES === '1';

describe.skipIf(!online)('Xiaohongshu controlled online smoke', () => {
  it('discovers and normalizes the anonymous campus list', async () => {
    const config = scriptedConfigSchema.parse({ pageSize: 100 });
    const context: DiscoverContext<ScriptedConfig> = {
      companyId: parseId('018f0000-0000-7000-8000-000000000107', 'Company'),
      sourceId: parseId('018f0000-0000-7000-8000-000000000207', 'JobSource'),
      requestId: `xiaohongshu-online-${String(Date.now())}`,
      config,
      signal: AbortSignal.timeout(60_000),
      timeoutMs: 20_000,
      http: new FetchSourceHttpClient(),
      cursor: null,
    };
    const jobs: Extract<DiscoveryEvent, { type: 'job' }>[] = [];
    let completion: Extract<DiscoveryEvent, { type: 'complete' }> | undefined;
    const adapter = createXiaohongshuAdapter();
    for await (const event of adapter.discover(context)) {
      if (event.type === 'job') jobs.push(event);
      if (event.type === 'complete') completion = event;
    }
    expect(completion?.coverage).toBe('complete');
    expect(jobs.length).toBeGreaterThan(0);
    const first = jobs[0];
    if (!first) return;
    await expect(
      adapter.normalize(
        { discovered: first.job, detail: null },
        { sourceId: context.sourceId, companyId: context.companyId, config },
      ),
    ).resolves.toHaveProperty('job.externalJobId', first.job.externalJobId);
  }, 90_000);
});
