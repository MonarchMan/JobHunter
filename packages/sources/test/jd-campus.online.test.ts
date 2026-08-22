import { parseId } from '@jobhunter/domain';
import {
  FetchSourceHttpClient,
  type DiscoverContext,
  type DiscoveryEvent,
} from '@jobhunter/source-core';
import { describe, expect, it } from 'vitest';
import { createJdCampusAdapter, jdCampusConfigSchema, type JdCampusConfig } from '../src/index.js';

const online = process.env.JOBHUNTER_ONLINE_SOURCES === '1';

describe.skipIf(!online)('JD campus controlled online smoke', () => {
  it('discovers the anonymous campus list', async () => {
    const config = jdCampusConfigSchema.parse({ pageSize: 100 });
    const context: DiscoverContext<JdCampusConfig> = {
      companyId: parseId('018f0000-0000-7000-8000-000000000109', 'Company'),
      sourceId: parseId('018f0000-0000-7000-8000-000000000209', 'JobSource'),
      requestId: `jd-campus-online-${String(Date.now())}`,
      config,
      signal: AbortSignal.timeout(30_000),
      timeoutMs: 20_000,
      http: new FetchSourceHttpClient(),
      cursor: null,
    };
    const jobs: Extract<DiscoveryEvent, { type: 'job' }>[] = [];
    let completion: Extract<DiscoveryEvent, { type: 'complete' }> | undefined;
    for await (const event of createJdCampusAdapter().discover(context)) {
      if (event.type === 'job') jobs.push(event);
      if (event.type === 'complete') completion = event;
    }
    expect(completion?.coverage).toBe('complete');
    expect(jobs.length).toBeGreaterThan(0);
  }, 40_000);
});
