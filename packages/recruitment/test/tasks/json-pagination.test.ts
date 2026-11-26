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
    sampled?: boolean;
    sharedJob?: boolean;
    many?: boolean;
    netease?: boolean;
    pageCount?: number;
    maximumPages?: number;
    secondTotal?: number;
    overlap?: 'same-page' | 'earlier-page';
  } = {},
): { calls: number[]; run: () => Promise<SourcePageCollection> } {
  const calls: number[] = [];
  const total = options.pageCount ? options.pageCount * 2 : options.many ? 10 : 4;
  const url = options.netease
    ? 'https://hr.163.com/api/hr163/position/queryPage'
    : 'https://hr.xiaomi.com/website/api/agent/searchJobPage?pageNum=1&pageSize=2&type=3';
  /** 按页码生成包含跨页重复的响应。 */
  function response(number: number): {
    data: { total: number; list: { id: string; jobPostId: string; jobId: string }[] };
  } {
    let ids = number === 1 ? ['a', 'b'] : ['b', 'd'];
    if (options.overlap) {
      const overlappingPages = [
        ['a', 'b'],
        ['c', 'd'],
        ['b', 'a'],
      ];
      ids =
        options.overlap === 'same-page'
          ? number <= 2
            ? ['a', 'b']
            : []
          : (overlappingPages[number - 1] ?? []);
    } else if (options.many || options.pageCount) ids = ['a', `page-${String(number)}`];
    else if (options.sharedJob) ids = number === 1 ? ['a', 'b'] : ['c', 'd'];
    if (!options.overlap && number > (options.pageCount ?? (options.many ? 5 : 2))) ids = [];
    return {
      data: {
        total: number === 2 ? (options.secondTotal ?? total) : total,
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

describe('Xiaomi publication identity and duplicate diagnostics', () => {
  it('keeps distinct publications sharing a jobId without false duplicate warnings', async () => {
    const h = fixture({ sharedJob: true });
    const result = await h.run();
    expect(result.coverage).toBe('complete');
    expect(result.diagnostics).toMatchObject({ duplicateIds: 0, discoveredCount: 4 });
    expect(h.calls).toEqual([2, 3]);
  });
  it('preserves persistent duplicates and their page evidence', async () => {
    const h = fixture();
    const result = await h.run();
    expect(result.coverage).toBe('complete');
    expect(result.diagnostics).toMatchObject({
      reason: null,
      absenceReliable: false,
      duplicateIds: 1,
      discoveredCount: 3,
      duplicateJobSamples: [{ id: 'b', pages: [1, 2] }],
    });
    expect(h.calls).toEqual([2, 3]);
  });
  it.each([3, 5])(
    'ignores reference total discrepancies after valid pagination: %s',
    async (secondTotal) => {
      const result = await fixture({ secondTotal }).run();
      expect(result.coverage).toBe('complete');
      expect(result.diagnostics).toMatchObject({ reason: null, absenceReliable: false });
    },
  );
  it.each([
    ['same-page', 'partial', 'pagination_not_advanced', [2]],
    ['earlier-page', 'complete', null, [2, 3, 4]],
  ] as const)(
    'distinguishes a repeated full page from overlap with an earlier page: %s',
    async (overlap, coverage, reason, calls) => {
      const h = fixture({ overlap });
      expect(await h.run()).toMatchObject({
        coverage,
        diagnostics: { reason, duplicateIds: 2, absenceReliable: false },
      });
      expect(h.calls).toEqual(calls);
    },
  );
  it('does not replay sampled collections', async () => {
    const h = fixture({ sampled: true });
    const result = await h.run();
    expect(result.diagnostics?.reason).toBe('sampled_pages');
    expect(h.calls).toEqual([]);
  });
  it('does not replay when several pages contain duplicates', async () => {
    const h = fixture({ many: true });
    const result = await h.run();
    expect(result.coverage).toBe('complete');
    expect(result.diagnostics).toMatchObject({ duplicateIds: 4, absenceReliable: false });
    expect(h.calls).toEqual([2, 3, 4, 5, 6]);
  });
});

describe('Netease actual unique count policy', () => {
  it('accepts duplicate records without replay or count warnings', async () => {
    const h = fixture({ netease: true });
    const result = await h.run();
    expect(h.calls).toEqual([2, 3]);
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
    expect(result.coverage).toBe('complete');
    expect(result.diagnostics?.reason).toBeNull();
    expect(result.diagnostics?.absenceReliable).toBe(false);
  });
  it('does not replay even when many pages contain duplicates', async () => {
    const h = fixture({ netease: true, pageCount: 34 });
    const result = await h.run();
    expect(result.coverage).toBe('complete');
    expect(result.diagnostics?.recheckedPages).toBeUndefined();
    expect(h.calls).toHaveLength(34);
  });
  it('does not recheck truncated collections', async () => {
    const h = fixture({ netease: true, pageCount: 3, maximumPages: 2 });
    const result = await h.run();
    expect(result.diagnostics?.reason).toBe('maximum_pages_reached');
    expect(result.diagnostics?.recheckedPages).toBeUndefined();
    expect(h.calls).toEqual([2]);
  });
});
