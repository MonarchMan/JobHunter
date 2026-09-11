import type { Page } from 'playwright';
import type { SourcePageCollectionRequest, SourcePageCollection } from '@jobhunter/source-core';
import { didiSites, didiMokaRuntimeReady, invokeDidiMoka } from '@jobhunter/sources';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectDidiMoka } from '../src/didi-browser.js';

vi.mock('node:timers/promises', () => ({ setTimeout: vi.fn().mockResolvedValue(undefined) }));
afterEach(() => vi.unstubAllGlobals());

/** 合成官网响应，不使用网络或真实会话。 */
function harness(overrides: Partial<SourcePageCollectionRequest> = {}): {
  page: Record<
    'goto' | 'url' | 'waitForFunction' | 'close' | 'isClosed' | 'evaluate',
    ReturnType<typeof vi.fn>
  >;
  run: () => Promise<SourcePageCollection>;
} {
  const request: SourcePageCollectionRequest = {
    sourceKey: 'didi.intern',
    requestId: 'fixture',
    url: didiSites['didi.intern'].entry,
    allowedHosts: ['app.mokahr.com'],
    signal: new AbortController().signal,
    timeoutMs: 1000,
    maximumPages: 2,
    pageSampling: 'first-last',
    pageSize: 30,
    maximumResponseBytes: 2 * 1024 * 1024,
    listEndpointPath: '/api/outer/ats-apply/website/jobs/v2',
    responseShape: 'didi-moka',
    ...overrides,
  };
  const page = {
    goto: vi.fn().mockResolvedValue(undefined),
    url: vi.fn().mockReturnValue(request.url),
    waitForFunction: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    isClosed: vi.fn().mockReturnValue(false),
    evaluate: vi
      .fn()
      .mockImplementation((_fn: unknown, input: Parameters<typeof invokeDidiMoka>[0]) =>
        Promise.resolve({
          jobStats: { orgId: 'didiglobal', total: 61 },
          jobs: Array.from({ length: input.page === 3 ? 1 : 30 }, (_, i) => ({
            id: `018f0000-0000-7000-8000-${String(((input.page ?? 1) - 1) * 30 + i + 1).padStart(12, '0')}`,
            orgId: 'didiglobal',
            status: 'open',
            hireMode: 1,
            commitment: '实习',
            title: '合成岗位',
            locations: [],
          })),
        }),
      ),
  };
  return { page, run: () => collectDidiMoka(page as unknown as Page, request, {}) };
}

describe('Didi original browser lifecycle (ADR-0023, SWT-014)', () => {
  it('requests only first/last, whitelists public records and closes the page', async () => {
    const h = harness();
    const value = await h.run();
    expect(value.pages.map((p) => p.page)).toEqual([1, 3]);
    expect(value).toMatchObject({
      coverage: 'partial',
      diagnostics: { reason: 'sampled_pages', expectedCount: 61 },
    });
    expect(h.page.evaluate.mock.calls.map((args) => args[1] as unknown)).toEqual([
      { key: 'didi.intern', operation: 'list', page: 1 },
      { key: 'didi.intern', operation: 'list', page: 3 },
    ]);
    expect(h.page.close).toHaveBeenCalledOnce();
    expect((await harness({ maximumPages: 1 }).run()).pages).toHaveLength(1);
  });
  it('fails closed on runtime drift, errors, response size, abort and wrong identity', async () => {
    const missing = harness();
    missing.page.waitForFunction.mockRejectedValue(new Error('timeout'));
    await expect(missing.run()).rejects.toMatchObject({ category: 'parse_changed' });
    expect(missing.page.close).toHaveBeenCalledOnce();
    const failed = harness();
    failed.page.evaluate.mockRejectedValue(new Error('private upstream data'));
    await expect(failed.run()).rejects.toMatchObject({
      message: 'Didi official client call failed.',
    });
    expect(failed.page.close).toHaveBeenCalledOnce();
    const large = harness({ maximumResponseBytes: 1 });
    await expect(large.run()).rejects.toMatchObject({ category: 'parse_changed' });
    expect(large.page.close).toHaveBeenCalledOnce();
    const aborted = harness({ signal: AbortSignal.abort() });
    await expect(aborted.run()).rejects.toMatchObject({ category: 'temporary' });
    expect(aborted.page.goto).not.toHaveBeenCalled();
    expect(aborted.page.close).toHaveBeenCalledOnce();
    const wrong = harness({ url: 'https://example.com' });
    await expect(wrong.run()).rejects.toMatchObject({ category: 'parse_changed' });
    expect(wrong.page.goto).not.toHaveBeenCalled();
  });
  it.each(['didi.intern', 'didi.campus', 'didi.campus.elite'] as const)(
    '%s uses the fixed client and exact site parameters',
    async (key) => {
      const post = vi.fn().mockResolvedValue({});
      const factory = vi.fn().mockReturnValue({ post });
      const require = Object.assign(vi.fn().mockReturnValue({ default: factory }), {
        m: { '0wyxq0': () => undefined },
      });
      vi.stubGlobal('__jobhunterDidiRequire', require);
      vi.stubGlobal('webpackChunkmage_cli_jsonp', { push: vi.fn() });
      expect(didiMokaRuntimeReady()).toBe(true);
      await invokeDidiMoka({ key, operation: 'list', page: 3 });
      expect(require).toHaveBeenCalledWith('0wyxq0');
      expect(factory).toHaveBeenCalledWith('/api/outer/ats-apply/website/jobs/v2');
      expect(post).toHaveBeenLastCalledWith({
        orgId: 'didiglobal',
        siteId: didiSites[key].siteId,
        limit: 30,
        offset: 60,
        needStat: true,
        jobIdTopList: [],
        customFields: {},
        site: key === 'didi.intern' ? 'social' : 'campus',
        locale: 'zh-CN',
      });
      const id = '018f0000-0000-7000-8000-000000000777';
      await invokeDidiMoka({ key, operation: 'detail', id });
      expect(factory).toHaveBeenLastCalledWith('/api/outer/ats-apply/website/job');
      expect(post).toHaveBeenLastCalledWith({
        orgId: 'didiglobal',
        siteId: Number(didiSites[key].siteId),
        jobId: id,
        locale: 'zh-CN',
      });
      await expect(invokeDidiMoka({ key, operation: 'list', page: 0 })).rejects.toThrow();
      await expect(invokeDidiMoka({ key, operation: 'detail', id: 'wrong' })).rejects.toThrow();
    },
  );
  it('does not pretend an uninitialized webpack queue is a runtime', () => {
    vi.stubGlobal('webpackChunkmage_cli_jsonp', []);
    vi.stubGlobal('__jobhunterDidiRequire', undefined);
    expect(didiMokaRuntimeReady()).toBe(false);
  });
});
