import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { parseId } from '@jobhunter/common/domain';
import {
  createNeteaseInternAdapter,
  neteaseConfigSchema,
  neteaseListSchema,
} from '@jobhunter/recruitment';
import {
  FetchSourceHttpClient,
  type DiscoveryEvent,
} from '@jobhunter/recruitment/source-contracts';

it('deduplicates Netease browser records through the channel view without downgrading success', async () => {
  // 1、使用合成官方协议样本，模拟多个分页重复返回同一实习职位。
  const fixture: unknown = JSON.parse(
    await readFile(new URL('./fixtures/netease/mixed/page-1.json', import.meta.url), 'utf8'),
  );
  const job = neteaseListSchema.parse(fixture).data.list[0];
  if (!job) throw new Error('Missing synthetic job');
  const adapter = createNeteaseInternAdapter();
  const events: DiscoveryEvent[] = [];
  for await (const event of adapter.discover({
    companyId: parseId('018f0000-0000-7000-8000-000000000111', 'Company'),
    sourceId: parseId('018f0000-0000-7000-8000-000000000214', 'JobSource'),
    requestId: 'netease-dedup-fixture',
    config: neteaseConfigSchema.parse({}),
    cursor: null,
    signal: new AbortController().signal,
    timeoutMs: 1000,
    http: new FetchSourceHttpClient(),
    page: {
      snapshot: () => Promise.reject(new Error('No network in fixture')),
      collect: () =>
        Promise.resolve({
          coverage: 'complete',
          pages: [1, 2].map((page) => ({
            page,
            url: 'https://hr.163.com/job-list.html',
            records: [job],
            total: 2,
            capturedAt: 0,
          })),
          diagnostics: {
            reason: null,
            retryable: false,
            expectedCount: 2,
            discoveredCount: 1,
            duplicateIds: 1,
            absenceReliable: false,
          },
        }),
    },
  }))
    events.push(event);
  // 2、分页适配器和实习过滤层均保留成功状态，仅产出一个职位和实际数量。
  expect(events.filter((event) => event.type === 'job')).toHaveLength(1);
  expect(events.at(-1)).toMatchObject({
    type: 'complete',
    coverage: 'complete',
    discoveredCount: 1,
    diagnostics: { reason: null, absenceReliable: false },
  });
});
