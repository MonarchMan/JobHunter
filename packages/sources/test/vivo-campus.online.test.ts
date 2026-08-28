import { parseId } from '@jobhunter/domain';
import {
  FetchSourceHttpClient,
  type DiscoverContext,
  type DiscoveryEvent,
  type JobSourceAdapter,
} from '@jobhunter/source-core';
import { describe, expect, it } from 'vitest';
import {
  createVivoCampusAdapter,
  createVivoInternAdapter,
  vivoCampusConfigSchema,
} from '../src/index.js';

const online = process.env.JOBHUNTER_ONLINE_SOURCES === '1';
const selected = new Set(
  (process.env.JOBHUNTER_ONLINE_SOURCE ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
);

async function verifyChannel(
  adapter: JobSourceAdapter<ReturnType<typeof vivoCampusConfigSchema.parse>, never>,
  expectedCategory: 'internship' | 'campus',
  sourceId: string,
): Promise<void> {
  const config = vivoCampusConfigSchema.parse({ pageSize: 300 });
  const context: DiscoverContext<typeof config> = {
    companyId: parseId('018f0000-0000-7000-8000-000000000112', 'Company'),
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
  expect(normalized.job.recruitmentCategory).toBe(expectedCategory);
  expect(normalized.job.description.length).toBeGreaterThan(0);
  expect(new URL(normalized.job.detailUrl).hostname).toBe('hr-campus.vivo.com');
}

describe.skipIf(!online || !selected.has('vivo-campus'))(
  'vivo campus controlled online gate',
  () => {
    it('discovers the complete current campus category', () =>
      verifyChannel(createVivoCampusAdapter(), 'campus', '018f0000-0000-7000-8000-000000000239'));
  },
);

describe.skipIf(!online || !selected.has('vivo-intern'))(
  'vivo intern controlled online gate',
  () => {
    it('discovers the complete current internship category', () =>
      verifyChannel(
        createVivoInternAdapter(),
        'internship',
        '018f0000-0000-7000-8000-000000000238',
      ));
  },
);
