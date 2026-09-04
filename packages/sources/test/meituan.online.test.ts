import { setTimeout as delay } from 'node:timers/promises';
import { parseId } from '@jobhunter/domain';
import {
  FetchSourceHttpClient,
  type DiscoverContext,
  type DiscoveryEvent,
  type SourceRateLimitGate,
} from '@jobhunter/source-core';
import { describe, expect, it } from 'vitest';
import { createMeituanAdapter, meituanConfigSchema, type MeituanConfig } from '../src/index.js';

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

describe.skipIf(!online)('Meituan controlled online smoke', () => {
  it(
    'discovers the complete anonymous set and normalizes a live detail',
    async () => {
      const adapter = createMeituanAdapter();
      const config: MeituanConfig = meituanConfigSchema.parse({ pageSize: 100 });
      const context: DiscoverContext<MeituanConfig> = {
        companyId: parseId('018f0000-0000-7000-8000-000000000106', 'Company'),
        sourceId: parseId('018f0000-0000-7000-8000-000000000206', 'JobSource'),
        requestId: `meituan-online-${String(Date.now())}`,
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
      expect(completion?.coverage).toBe('complete');
      expect(jobs.length).toBeGreaterThan(0);
      expect(new Set(jobs.map((event) => event.job.externalJobId)).size).toBe(jobs.length);

      const first = jobs[0];
      expect(first).toBeDefined();
      if (!first) return;
      const detail = await adapter.fetchDetail?.(first.job, context);
      await expect(
        adapter.normalize(
          { discovered: first.job, detail: detail ?? null },
          { companyId: context.companyId, sourceId: context.sourceId, config },
        ),
      ).resolves.toHaveProperty('job.externalJobId', first.job.externalJobId);
    },
    4 * 60_000,
  );
});
