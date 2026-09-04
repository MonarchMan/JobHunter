import { setTimeout as delay } from 'node:timers/promises';
import { parseId } from '@jobhunter/domain';
import {
  FetchSourceHttpClient,
  type DiscoverContext,
  type DiscoveryEvent,
  type SourceRateLimitGate,
} from '@jobhunter/source-core';
import { describe, expect, it } from 'vitest';
import { createJdAdapter, jdConfigSchema, type JdConfig } from '../src/index.js';

/** 构造测试输入或执行断言的辅助逻辑。 */
class OnlineSmokeGate implements SourceRateLimitGate {
  #nextAt = 0;

  public async beforeRequest(input: {
    readonly sourceKey: string;
    readonly signal: AbortSignal;
  }): Promise<void> {
    const waitMs = Math.max(0, this.#nextAt - Date.now());
    if (waitMs > 0) await delay(waitMs, undefined, { signal: input.signal });
    this.#nextAt = Date.now() + 5_000;
  }
}

const online = process.env.JOBHUNTER_ONLINE_SOURCES === '1';

describe.skipIf(!online)('JD controlled online smoke', () => {
  it(
    'discovers the complete anonymous inline list and normalizes a live job',
    async () => {
      const adapter = createJdAdapter();
      const config: JdConfig = jdConfigSchema.parse({ pageSize: 100 });
      const context: DiscoverContext<JdConfig> = {
        companyId: parseId('018f0000-0000-7000-8000-000000000109', 'Company'),
        sourceId: parseId('018f0000-0000-7000-8000-000000000209', 'JobSource'),
        requestId: `jd-online-${String(Date.now())}`,
        config,
        signal: AbortSignal.timeout(3 * 60_000),
        timeoutMs: 20_000,
        http: new FetchSourceHttpClient({ rateLimitGate: new OnlineSmokeGate() }),
        cursor: null,
      };
      const jobs: Extract<DiscoveryEvent, { type: 'job' }>[] = [];
      let completion: Extract<DiscoveryEvent, { type: 'complete' }> | undefined;
      for await (const event of adapter.discover(context)) {
        if (event.type === 'job') jobs.push(event);
        if (event.type === 'complete') completion = event;
      }
      // The current anonymous endpoint repeats four requirement IDs across its
      // 18 pages. The adapter deduplicates them and reports partial coverage;
      // this keeps a moving, inconsistent list from closing existing jobs.
      expect(completion?.coverage).toBe('partial');
      expect(jobs.length).toBeGreaterThan(0);
      expect(new Set(jobs.map((event) => event.job.externalJobId)).size).toBe(jobs.length);
      const first = jobs[0];
      expect(first).toBeDefined();
      if (!first) return;
      await expect(
        adapter.normalize(
          { discovered: first.job, detail: null },
          { companyId: context.companyId, sourceId: context.sourceId, config },
        ),
      ).resolves.toHaveProperty('job.externalJobId', first.job.externalJobId);
    },
    4 * 60_000,
  );
});
