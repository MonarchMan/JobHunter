import { setTimeout as delay } from 'node:timers/promises';
import { parseId } from '@jobhunter/domain';
import {
  FetchSourceHttpClient,
  collectDiscovery,
  type DiscoverContext,
  type SourceRateLimitGate,
} from '@jobhunter/source-core';
import { describe, expect, it } from 'vitest';
import { createTencentAdapter, type TencentConfig } from '../src/index.js';

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

describe.skipIf(!online)('Tencent controlled online smoke', () => {
  it(
    'discovers the complete anonymous set and normalizes a live detail',
    async () => {
      const adapter = createTencentAdapter();
      const config: TencentConfig = { language: 'zh-cn', pageSize: 100 };
      const context: DiscoverContext<TencentConfig> = {
        companyId: parseId('018f0000-0000-7000-8000-000000000101', 'Company'),
        sourceId: parseId('018f0000-0000-7000-8000-000000000201', 'JobSource'),
        requestId: `tencent-online-${String(Date.now())}`,
        config,
        signal: AbortSignal.timeout(10 * 60_000),
        timeoutMs: 20_000,
        http: new FetchSourceHttpClient({ rateLimitGate: new OnlineSmokeGate() }),
        cursor: null,
      };
      const discovery = await collectDiscovery(adapter.discover(context));
      expect(discovery.completion.coverage).toBe('complete');
      expect(discovery.ids.length).toBeGreaterThan(0);
      expect(new Set(discovery.ids).size).toBe(discovery.ids.length);

      const firstId = discovery.ids[0];
      expect(firstId).toBeDefined();
      if (!firstId) return;
      const discovered = {
        externalJobId: firstId,
        sourceUrl: `https://careers.tencent.com/jobdesc.html?postId=${firstId}`,
        raw: await context.http
          .request({
            sourceKey: 'tencent.social',
            requestId: context.requestId,
            url: `https://careers.tencent.com/tencentcareer/api/post/ByPostId?postId=${firstId}&language=zh-cn`,
            allowedHosts: ['careers.tencent.com'],
            signal: context.signal,
            responseType: 'json',
            timeoutMs: context.timeoutMs,
          })
          .then((response) => {
            const body = response.body as { Data?: unknown };
            return body.Data;
          }),
      };
      const detail = await adapter.fetchDetail?.(discovered, context);
      await expect(
        adapter.normalize(
          { discovered, detail: detail ?? null },
          { companyId: context.companyId, sourceId: context.sourceId, config },
        ),
      ).resolves.toHaveProperty('job.externalJobId', firstId);
    },
    11 * 60_000,
  );
});
