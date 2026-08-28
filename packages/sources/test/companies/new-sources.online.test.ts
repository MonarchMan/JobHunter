import { parseId } from '@jobhunter/domain';
import {
  FetchSourceHttpClient,
  type DiscoverContext,
  type DiscoveryEvent,
  type JobSourceAdapter,
} from '@jobhunter/source-core';
import { describe, expect, it } from 'vitest';
import {
  createNeteaseSocialAdapter,
  createOppoInternAdapter,
  createVivoSocialAdapter,
  createXiaomiInternAdapter,
  neteaseConfigSchema,
  oppoInternConfigSchema,
  vivoSocialConfigSchema,
  xiaomiInternConfigSchema,
} from '../../src/index.js';

const online = process.env.JOBHUNTER_ONLINE_SOURCES === '1';
const selected = new Set(
  (process.env.JOBHUNTER_ONLINE_SOURCE ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
);

async function runOnline<TConfig>(
  factory: () => JobSourceAdapter<TConfig, never>,
  config: TConfig,
  companyId: string,
  sourceId: string,
): Promise<void> {
  const adapter = factory();
  const context: DiscoverContext<TConfig> = {
    companyId: parseId(companyId, 'Company'),
    sourceId: parseId(sourceId, 'JobSource'),
    requestId: `${adapter.metadata.key}-online-${String(Date.now())}`,
    config,
    signal: AbortSignal.timeout(180_000),
    timeoutMs: 30_000,
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
  const normalized = await adapter.normalize(
    { discovered: first.job, detail: null },
    { sourceId: context.sourceId, companyId: context.companyId, config },
  );
  expect(normalized.job.externalJobId).toBe(first.job.externalJobId);
  expect(adapter.metadata.officialHosts).toContain(new URL(normalized.job.detailUrl).hostname);
}

describe.skipIf(!online || !selected.has('xiaomi'))('Xiaomi controlled online smoke', () => {
  it('discovers every current internship page', () =>
    runOnline(
      createXiaomiInternAdapter,
      xiaomiInternConfigSchema.parse({ pageSize: 100 }),
      '018f0000-0000-7000-8000-000000000111',
      '018f0000-0000-7000-8000-000000000214',
    ));
});

describe.skipIf(!online || !selected.has('vivo'))('vivo controlled online smoke', () => {
  it('discovers every current social page', () =>
    runOnline(
      createVivoSocialAdapter,
      vivoSocialConfigSchema.parse({ pageSize: 100 }),
      '018f0000-0000-7000-8000-000000000112',
      '018f0000-0000-7000-8000-000000000215',
    ));
});

describe.skipIf(!online || !selected.has('oppo'))('OPPO controlled online smoke', () => {
  it('discovers the complete current internship project', () =>
    runOnline(
      createOppoInternAdapter,
      oppoInternConfigSchema.parse({ pageSize: 100 }),
      '018f0000-0000-7000-8000-000000000113',
      '018f0000-0000-7000-8000-000000000216',
    ));
});

describe.skipIf(!online || !selected.has('netease'))('NetEase controlled online smoke', () => {
  it('discovers every current mixed-recruitment page', () =>
    runOnline(
      createNeteaseSocialAdapter,
      neteaseConfigSchema.parse({ pageSize: 100 }),
      '018f0000-0000-7000-8000-000000000115',
      '018f0000-0000-7000-8000-000000000218',
    ));
});
