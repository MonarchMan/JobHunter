import type { Page } from 'playwright';
import { describe, expect, it } from 'vitest';
import { collectJsonPages } from '@jobhunter/recruitment/tasks/browser-source';
import type {
  SourcePageCollectionRequest,
  SourcePageCollection,
} from '@jobhunter/recruitment/source-contracts';

/** 合成两页官网响应，保留 jobId 与发布 ID 不同的事实，不访问网络。 */
function fixture(
  options: {
    recovery?: 'stable' | 'missing' | 'changed';
    sampled?: boolean;
    sharedJob?: boolean;
    many?: boolean;
    netease?: boolean;
    pageCount?: number;
    maximumPages?: number;
    secondTotal?: number;
  } = {},
): { calls: number[]; run: () => Promise<SourcePageCollection> } {
  const calls: number[] = [];
  const counts = new Map<number, number>();
  const total = options.pageCount ? options.pageCount * 2 : options.many ? 10 : 4;
  const url = options.netease
    ? 'https://hr.163.com/api/hr163/position/queryPage'
    : 'https://hr.xiaomi.com/website/api/agent/searchJobPage?pageNum=1&pageSize=2&type=3';
  /** 按页码和请求轮次生成响应，重读只替换当前页。 */
  function response(number: number): {
    data: { total: number; list: { id: string; jobPostId: string; jobId: string }[] };
  } {
    const count = (counts.get(number) ?? 0) + 1;
    counts.set(number, count);
    let ids = number === 1 ? ['a', 'b'] : ['b', 'd'];
    if (options.many || options.pageCount) ids = ['a', `page-${String(number)}`];
    else if (options.sharedJob) ids = number === 1 ? ['a', 'b'] : ['c', 'd'];
    else if (count > 1 && options.recovery)
      ids = number === 1 ? ['a', 'c'] : options.recovery === 'missing' ? ['b'] : ['b', 'd'];
    return {
      data: {
        total:
          number === 2 && options.secondTotal !== undefined
            ? options.secondTotal
            : count > 1 && options.recovery === 'changed'
              ? 5
              : total,
        list: ids.map((id) => ({
          id,
          jobPostId: id,
          jobId: options.sharedJob ? 'shared-job' : `job-${id}`,
        })),
      },
    };
  }
  const page = {
    goto: () => Promise.resolve(undefined),
    url: () => url,
    waitForResponse: () =>
      Promise.resolve({
        url: () => url,
        status: () => 200,
        request: () => ({
          method: () => (options.netease ? 'POST' : 'GET'),
          headers: () => ({}),
          postData: () => null,
          postDataJSON: () => ({ currentPage: 1, pageSize: 2 }),
        }),
        json: () => Promise.resolve(response(1)),
      }),
    evaluate: (
      _fn: unknown,
      input: { target: { url: string; body: { currentPage?: number } } },
    ) => {
      const number = options.netease
        ? Number(input.target.body.currentPage)
        : Number(new URL(input.target.url).searchParams.get('pageNum'));
      calls.push(number);
      return Promise.resolve({ url: input.target.url, status: 200, body: response(number) });
    },
  } as unknown as Page;
  const request: SourcePageCollectionRequest = {
    sourceKey: options.netease ? 'netease.mixed' : 'xiaomi.intern',
    requestId: 'fixture',
    url,
    allowedHosts: [new URL(url).hostname],
    signal: new AbortController().signal,
    timeoutMs: 1000,
    maximumPages: options.maximumPages ?? 40,
    maximumResponseBytes: 100_000,
    pageSize: 2,
    responseShape: options.netease ? 'netease-jobs' : 'xiaomi-jobs',
    listEndpointPath: new URL(url).pathname,
  };
  return {
    calls,
    run: () =>
      collectJsonPages(
        page,
        request,
        options.sampled ? { maximumPages: 1, pageSampling: 'first-last' } : {},
      ),
  };
}

describe('Xiaomi publication identity and bounded pagination recovery', () => {
  it('keeps distinct publications sharing a jobId without false duplicate warnings', async () => {
    const h = fixture({ sharedJob: true });
    const result = await h.run();
    expect(result.coverage).toBe('complete');
    expect(result.diagnostics).toMatchObject({ duplicateIds: 0, discoveredCount: 4 });
    expect(h.calls).toEqual([2]);
  });
  it('replaces affected pages once and recomputes completeness', async () => {
    const h = fixture({ recovery: 'stable' });
    const result = await h.run();
    expect(result.coverage).toBe('complete');
    expect(result.pages.flatMap((page) => page.records.map((record) => record.id))).toEqual([
      'a',
      'c',
      'b',
      'd',
    ]);
    expect(result.diagnostics).toMatchObject({
      reason: null,
      duplicateIds: 0,
      recheckedPages: [1, 2],
    });
    expect(h.calls).toEqual([2, 1, 2]);
  });
  it('preserves persistent duplicates and their page evidence', async () => {
    const h = fixture();
    const result = await h.run();
    expect(result.coverage).toBe('partial');
    expect(result.diagnostics).toMatchObject({
      reason: 'duplicate_job_ids',
      duplicateIds: 1,
      discoveredCount: 3,
      duplicateJobSamples: [{ id: 'b', pages: [1, 2] }],
    });
    expect(h.calls).toEqual([2, 1, 2]);
  });
  it.each(['missing', 'changed'] as const)(
    'does not call an incomplete %s snapshot complete',
    async (recovery) => {
      const result = await fixture({ recovery }).run();
      expect(result.coverage).toBe('partial');
      expect(result.diagnostics?.reason).toBe(
        recovery === 'missing' ? 'discovered_count_mismatch' : 'pagination_total_changed',
      );
    },
  );
  it('does not recover sampled collections', async () => {
    const h = fixture({ sampled: true });
    const result = await h.run();
    expect(result.diagnostics?.reason).toBe('sampled_pages');
    expect(h.calls).toEqual([]);
  });
  it('caps the recovery at four pages', async () => {
    const h = fixture({ many: true });
    const result = await h.run();
    expect(result.coverage).toBe('partial');
    expect(result.diagnostics?.recheckedPages).toEqual([1, 2, 3, 4]);
    expect(h.calls).toEqual([2, 3, 4, 5, 1, 2, 3, 4]);
  });
});

describe('Netease actual unique count policy', () => {
  it('accepts duplicate records without replay or count warnings', async () => {
    const h = fixture({ netease: true });
    const result = await h.run();
    expect(h.calls).toEqual([2]);
    expect(result.coverage).toBe('complete');
    expect(result.diagnostics).toMatchObject({
      reason: null,
      expectedCount: 4,
      discoveredCount: 3,
      duplicateIds: 1,
      absenceReliable: false,
    });
    expect(result.diagnostics?.recheckedPages).toBeUndefined();
  });
  it.each([3, 5])('uses total %s only as a page-count reference', async (secondTotal) => {
    const result = await fixture({ netease: true, secondTotal }).run();
    expect(result.coverage).toBe(secondTotal === 3 ? 'complete' : 'partial');
    expect(result.diagnostics?.reason).toBe(secondTotal === 3 ? null : 'pagination_total_changed');
    expect(result.diagnostics?.absenceReliable).toBe(false);
  });
  it('does not replay even when many pages contain duplicates', async () => {
    const h = fixture({ netease: true, pageCount: 34 });
    const result = await h.run();
    expect(result.coverage).toBe('complete');
    expect(result.diagnostics?.recheckedPages).toBeUndefined();
    expect(h.calls).toHaveLength(33);
  });
  it('does not recheck truncated collections', async () => {
    const h = fixture({ netease: true, pageCount: 3, maximumPages: 2 });
    const result = await h.run();
    expect(result.diagnostics?.reason).toBe('maximum_pages_reached');
    expect(result.diagnostics?.recheckedPages).toBeUndefined();
    expect(h.calls).toEqual([2]);
  });
});
