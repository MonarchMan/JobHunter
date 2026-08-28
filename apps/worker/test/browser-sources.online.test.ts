import { parseId } from '@jobhunter/domain';
import {
  FetchSourceHttpClient,
  type DiscoverContext,
  type DiscoveryEvent,
  type JobSourceAdapter,
} from '@jobhunter/source-core';
import {
  createAlibabaAdapter,
  createByteDanceAdapter,
  createByteDanceCampusAdapter,
  createDewuAdapter,
  createHuaweiAdapter,
  createMeituanInternAdapter,
  createQihoo360SocialAdapter,
  meituanConfigSchema,
  qihoo360ConfigSchema,
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

describe.skipIf(!online || !selected.has('qihoo360'))('360 controlled browser online smoke', () => {
  it('collects and normalizes the current anonymous official list', async () => {
    const config = qihoo360ConfigSchema.parse({});
    const context: DiscoverContext<typeof config> = {
      companyId: parseId('018f0000-0000-7000-8000-000000000114', 'Company'),
      sourceId: parseId('018f0000-0000-7000-8000-000000000217', 'JobSource'),
      requestId: `qihoo360-browser-online-${String(Date.now())}`,
      config,
      signal: AbortSignal.timeout(120_000),
      timeoutMs: 60_000,
      http: new FetchSourceHttpClient(),
      page: createPlaywrightSourcePageClient({
        headless: true,
        navigationTimeoutMs: 60_000,
        maximumPages: 2,
      }),
      cursor: null,
    };
    const adapter = createQihoo360SocialAdapter();
    const jobs: Extract<DiscoveryEvent, { type: 'job' }>[] = [];
    let completion: Extract<DiscoveryEvent, { type: 'complete' }> | undefined;
    for await (const event of adapter.discover(context)) {
      if (event.type === 'job') jobs.push(event);
      if (event.type === 'complete') completion = event;
    }
    expect(completion?.coverage).toBe('complete');
    expect(jobs.length).toBeGreaterThan(0);
    const first = jobs[0];
    if (!first) return;
    expect(adapter.fetchDetail).toBeDefined();
    if (!adapter.fetchDetail) return;
    const detail = await adapter.fetchDetail(first.job, context);
    await expect(
      adapter.normalize(
        { discovered: first.job, detail },
        { sourceId: context.sourceId, companyId: context.companyId, config },
      ),
    ).resolves.toMatchObject({
      job: { recruitmentCategory: 'social', description: detail.description },
    });
  }, 130_000);
});

interface BrowserSmokeDefinition {
  readonly slug: 'alibaba' | 'bytedance' | 'bytedance-campus' | 'dewu' | 'huawei';
  readonly factory: () => JobSourceAdapter<ScriptedConfig, never>;
}

describe.skipIf(!online || !selected.has('meituan'))(
  'meituan controlled browser online smoke',
  () => {
    it('initializes the anonymous campus session and replays internship JSON pages', async () => {
      const config = meituanConfigSchema.parse({ pageSize: 100 });
      const context: DiscoverContext<typeof config> = {
        companyId: parseId('018f0000-0000-7000-8000-000000000106', 'Company'),
        sourceId: parseId('018f0000-0000-7000-8000-000000000212', 'JobSource'),
        requestId: `meituan-browser-online-${String(Date.now())}`,
        config,
        signal: AbortSignal.timeout(120_000),
        timeoutMs: 30_000,
        http: new FetchSourceHttpClient(),
        page: createPlaywrightSourcePageClient({
          headless: true,
          navigationTimeoutMs: 30_000,
          maximumPages: 2,
        }),
        cursor: null,
      };
      const adapter = createMeituanInternAdapter();
      const jobs: Extract<DiscoveryEvent, { type: 'job' }>[] = [];
      let completion: Extract<DiscoveryEvent, { type: 'complete' }> | undefined;
      for await (const event of adapter.discover(context)) {
        if (event.type === 'job') jobs.push(event);
        if (event.type === 'complete') completion = event;
      }
      expect(completion?.pages).toBeGreaterThan(0);
      expect(jobs.length).toBeGreaterThan(0);
      const first = jobs[0];
      if (!first) return;
      const normalized = await adapter.normalize(
        { discovered: first.job, detail: null },
        { sourceId: context.sourceId, companyId: context.companyId, config },
      );
      expect(normalized.job.recruitmentCategory).toBe('internship');
    }, 130_000);
  },
);

const definitions: readonly BrowserSmokeDefinition[] = [
  { slug: 'alibaba', factory: createAlibabaAdapter },
  { slug: 'bytedance', factory: createByteDanceAdapter },
  { slug: 'bytedance-campus', factory: createByteDanceCampusAdapter },
  { slug: 'dewu', factory: createDewuAdapter },
  { slug: 'huawei', factory: createHuaweiAdapter },
];

for (const definition of definitions) {
  describe.skipIf(!online || !selected.has(definition.slug))(
    `${definition.slug} controlled browser online smoke`,
    () => {
      it('collects at most two anonymous pages and normalizes an official job', async () => {
        const config = scriptedConfigSchema.parse({ pageSize: 100 });
        const context: DiscoverContext<ScriptedConfig> = {
          companyId: parseId('018f0000-0000-7000-8000-000000000102', 'Company'),
          sourceId: parseId('018f0000-0000-7000-8000-000000000202', 'JobSource'),
          requestId: `${definition.slug}-browser-online-${String(Date.now())}`,
          config,
          signal: AbortSignal.timeout(120_000),
          timeoutMs: 30_000,
          http: new FetchSourceHttpClient(),
          page: createPlaywrightSourcePageClient({
            headless: true,
            navigationTimeoutMs: 30_000,
            maximumPages: 2,
          }),
          cursor: null,
        };
        const jobs: Extract<DiscoveryEvent, { type: 'job' }>[] = [];
        let completion: Extract<DiscoveryEvent, { type: 'complete' }> | undefined;
        const adapter = definition.factory();
        for await (const event of adapter.discover(context)) {
          if (event.type === 'job') jobs.push(event);
          if (event.type === 'complete') completion = event;
        }
        expect(completion).toBeDefined();
        expect(completion?.coverage).not.toBe('unknown');
        expect(completion?.pages).toBeGreaterThan(0);
        expect(completion?.pages).toBeLessThanOrEqual(2);
        expect(jobs.length).toBeGreaterThan(0);
        expect(new Set(jobs.map(({ job }) => job.externalJobId)).size).toBe(jobs.length);
        const first = jobs[0];
        if (!first) return;
        const normalized = await adapter.normalize(
          { discovered: first.job, detail: null },
          { sourceId: context.sourceId, companyId: context.companyId, config },
        );
        expect(normalized.job.externalJobId).toBe(first.job.externalJobId);
        expect(new URL(normalized.job.detailUrl).protocol).toBe('https:');
        expect(adapter.metadata.officialHosts).toContain(
          new URL(normalized.job.detailUrl).hostname,
        );
        if (definition.slug === 'bytedance-campus') {
          expect(normalized.job.recruitmentCategory).toBe('internship');
        }
      }, 130_000);
    },
  );
}
