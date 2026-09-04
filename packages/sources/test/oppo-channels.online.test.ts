import { parseId } from '@jobhunter/domain';
import {
  FetchSourceHttpClient,
  type DiscoverContext,
  type DiscoveryEvent,
  type JobSourceAdapter,
} from '@jobhunter/source-core';
import { describe, expect, it } from 'vitest';
import {
  createOppoCampusAdapter,
  createOppoSocialAdapter,
  oppoInternConfigSchema,
  oppoSocialConfigSchema,
} from '../src/index.js';

const online = process.env.JOBHUNTER_ONLINE_SOURCES === '1';
const selected = new Set(
  (process.env.JOBHUNTER_ONLINE_SOURCE ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
);

/** 构造测试输入或执行断言的辅助逻辑。 */
async function verifyChannel<TConfig>(
  adapter: JobSourceAdapter<TConfig, never>,
  config: TConfig,
  sourceId: string,
  category: 'campus' | 'social',
): Promise<void> {
  const context: DiscoverContext<TConfig> = {
    companyId: parseId('018f0000-0000-7000-8000-000000000113', 'Company'),
    sourceId: parseId(sourceId, 'JobSource'),
    requestId: `${adapter.metadata.key}-online-${String(Date.now())}`,
    config,
    cursor: null,
    signal: AbortSignal.timeout(180_000),
    timeoutMs: 30_000,
    http: new FetchSourceHttpClient(),
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
    { companyId: context.companyId, sourceId: context.sourceId, config },
  );
  expect(normalized.job.recruitmentCategory).toBe(category);
  expect(normalized.job.description.length).toBeGreaterThan(0);
}

describe.skipIf(!online || !selected.has('oppo-campus'))(
  'OPPO campus controlled online gate',
  () => {
    it('discovers all current graduate and doctor jobs', () =>
      verifyChannel(
        createOppoCampusAdapter(),
        oppoInternConfigSchema.parse({ pageSize: 300 }),
        '018f0000-0000-7000-8000-000000000240',
        'campus',
      ));
  },
);

describe.skipIf(!online || !selected.has('oppo-social'))(
  'OPPO social controlled online gate',
  () => {
    it('discovers all current social jobs', () =>
      verifyChannel(
        createOppoSocialAdapter(),
        oppoSocialConfigSchema.parse({ pageSize: 200 }),
        '018f0000-0000-7000-8000-000000000241',
        'social',
      ));
  },
);
