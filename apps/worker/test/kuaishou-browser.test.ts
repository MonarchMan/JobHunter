import type { Page } from 'playwright';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  invokeKuaishouRuntime,
  kuaishouRuntimeReady,
  kuaishouSite,
  type KuaishouKey,
} from '@jobhunter/sources';
import type { SourcePageCollectionRequest, SourcePageCollection } from '@jobhunter/source-core';
import type { BrowserSourceOptions } from '../src/browser-source.js';
import { collectKuaishouPages } from '../src/kuaishou-browser.js';

vi.mock('node:timers/promises', () => ({ setTimeout: vi.fn().mockResolvedValue(undefined) }));

/** 所有岗位/字典均为合成协议样本，页面不访问网络。 */
function harness(
  key: KuaishouKey = 'kuaishou.social',
  overrides: Partial<SourcePageCollectionRequest> = {},
): {
  request: SourcePageCollectionRequest;
  page: Record<'goto' | 'waitForFunction' | 'close' | 'isClosed', ReturnType<typeof vi.fn>> & {
    evaluate: ReturnType<
      typeof vi.fn<
        (fn: unknown, input: Parameters<typeof invokeKuaishouRuntime>[0]) => Promise<unknown>
      >
    >;
  };
  run: (options?: BrowserSourceOptions) => Promise<SourcePageCollection>;
} {
  const site = kuaishouSite(key);
  const request: SourcePageCollectionRequest = {
    sourceKey: key,
    requestId: 'fixture',
    url: site.entry,
    allowedHosts: [site.host],
    signal: new AbortController().signal,
    timeoutMs: 1000,
    maximumPages: 100,
    maximumResponseBytes: 2 * 1024 * 1024,
    pageSize: 1,
    listEndpointPath: site.endpoint,
    responseShape: 'kuaishou-jobs',
    ...overrides,
  };
  const page = {
    goto: vi.fn().mockResolvedValue(undefined),
    waitForFunction: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    isClosed: vi.fn().mockReturnValue(false),
    evaluate: vi
      .fn()
      .mockImplementation((_fn: unknown, input: Parameters<typeof invokeKuaishouRuntime>[0]) => {
        if (input.operation === 'dictionaries')
          return Promise.resolve({
            code: 0,
            result: { workLocation: [{ code: 'beijing', name: '北京' }] },
          });
        if (input.operation === 'projects')
          return Promise.resolve({
            code: 0,
            result: {
              total: 1,
              list: [{ code: 'current', year: '2027', active: true, projectType: site.nature }],
            },
          });
        return Promise.resolve({
          code: 0,
          result: {
            total: 3,
            pageNum: input.pageNum,
            pageSize: 1,
            list: [
              {
                id: input.pageNum,
                name: '测试岗位',
                description: '测试职责',
                positionDemand: '测试要求',
                positionNatureCode: site.nature,
                recruitProjectCode: site.campus ? 'schoolr' : 'socialr',
                ...(site.campus
                  ? {
                      recruitSubProjectCode: 'current',
                      workLocationDicts: [{ code: 'beijing', name: '北京' }],
                    }
                  : { workLocationsCode: ['beijing'] }),
              },
            ],
          },
        });
      }),
  };
  return {
    request,
    page,
    run: (options = {}) => collectKuaishouPages(page as unknown as Page, request, options),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('Kuaishou native browser lifecycle (ADR-0023)', () => {
  it.each(['recover', 'persistent', 'total-change', 'sampled'] as const)(
    'rechecks duplicate pages once without unioning stale results: %s',
    async (mode) => {
      const h = harness();
      const original = h.page.evaluate.getMockImplementation();
      if (!original) throw new Error('Missing fixture implementation');
      const calls = new Map<number, number>();
      h.page.evaluate.mockImplementation(
        async (fn: unknown, input: Parameters<typeof invokeKuaishouRuntime>[0]) => {
          const response = (await original(fn, input)) as {
            result: { total: number; list: { id: number }[] };
          };
          if (input.operation === 'list' && input.pageNum) {
            const attempt = (calls.get(input.pageNum) ?? 0) + 1;
            calls.set(input.pageNum, attempt);
            if (input.pageNum === 3 && (attempt === 1 || mode !== 'recover')) {
              const job = response.result.list[0];
              if (!job) throw new Error('Missing fixture job');
              job.id = 1;
            }
            if (mode === 'total-change' && attempt > 1) response.result.total = 4;
          }
          return response;
        },
      );
      const result = await h.run(
        mode === 'sampled' ? { maximumPages: 2, pageSampling: 'first-last' } : {},
      );
      expect(result.coverage).toBe(mode === 'recover' ? 'complete' : 'partial');
      expect(result.pages).toHaveLength(mode === 'sampled' ? 2 : 3);
      if (mode === 'sampled') {
        expect([...calls.values()]).toEqual([1, 1]);
        expect(result.diagnostics?.recheckedPages).toBeUndefined();
      } else {
        expect(result.diagnostics?.recheckedPages).toEqual([1, 3]);
        expect(calls.get(1)).toBe(2);
        expect(calls.get(2)).toBe(1);
        expect(calls.get(3)).toBe(2);
      }
      if (mode === 'persistent')
        expect(result.diagnostics).toMatchObject({
          reason: 'duplicate_job_ids',
          duplicateIds: 1,
          discoveredCount: 2,
          duplicateJobSamples: [{ id: '1', pages: [1, 3] }],
        });
      if (mode === 'recover')
        expect(result.diagnostics).toMatchObject({
          reason: null,
          duplicateIds: 0,
          discoveredCount: 3,
        });
    },
  );

  it.each([false, true])(
    'uses verified export shape when campus=%s, including modules absent from the chunk queue',
    async (campus) => {
      const call = vi.fn().mockResolvedValue({ code: 0 });
      /** 模拟主站已核验的原始 API 构造器，仅用于断言导出形态。 */
      class OfficialApi {
        public positionSimpleUsingGET = call;
      }
      const requireModule = Object.assign(
        vi
          .fn()
          .mockReturnValue(campus ? { a: { indexUsingPOST: call } } : { DefaultApi: OfficialApi }),
        { m: { './src/services/api/DefaultApi.ts': () => undefined } },
      );
      vi.stubGlobal('__jobhunterKuaishouRequire', requireModule);
      vi.stubGlobal('__jobhunterKuaishouApi', undefined);
      // 空 chunk 队列仍已由 runtime 接管，固定模块存在于 require.m 即可。
      vi.stubGlobal('webpackJsonp', { push: vi.fn() });
      expect(kuaishouRuntimeReady()).toBe(true);
      await invokeKuaishouRuntime({
        campus,
        operation: 'list',
        pageNum: 2,
        pageSize: 50,
        nature: 'C001',
        ...(campus ? { project: 'current' } : {}),
      });
      expect(requireModule).toHaveBeenCalledWith('./src/services/api/DefaultApi.ts');
      expect(call).toHaveBeenCalledWith(
        campus
          ? { pageNum: 2, pageSize: 50, recruitSubProjectCodes: ['current'] }
          : { pageNum: 2, pageSize: 50, positionNatureCode: 'C001', recruitProject: 'socialr' },
      );
    },
  );

  it('reports missing runtime as protocol drift and releases the page', async () => {
    const h = harness();
    h.page.waitForFunction.mockRejectedValue(new Error('timeout'));
    await expect(h.run()).rejects.toMatchObject({ category: 'parse_changed' });
    expect(h.page.close).toHaveBeenCalledOnce();
  });

  it.each([
    'kuaishou.social',
    'kuaishou.intern',
    'kuaishou.intern.campus',
    'kuaishou.campus',
  ] as const)(
    '%s isolates first/last and calls only native metadata/list operations',
    async (key) => {
      const h = harness(key);
      const result = await h.run({ maximumPages: 2, pageSampling: 'first-last' });
      expect(result.pages.map((p) => p.page)).toEqual([1, 3]);
      expect(result).toMatchObject({
        coverage: 'partial',
        diagnostics: { reason: 'sampled_pages', expectedCount: 3, duplicateIds: 0 },
      });
      expect(h.page.goto).toHaveBeenCalledWith(kuaishouSite(key).bootstrap, expect.anything());
      expect(h.page.evaluate.mock.calls.map((args) => args[1].operation)).toEqual([
        kuaishouSite(key).campus ? 'projects' : 'dictionaries',
        'list',
        'list',
      ]);
      expect(h.page.close).toHaveBeenCalledOnce();
    },
  );
  it('only marks complete after all synthetic pages close and caps health to one', async () => {
    expect((await harness().run()).coverage).toBe('complete');
    const h = harness('kuaishou.social', { maximumPages: 1 });
    expect(
      (await h.run({ maximumPages: 2, pageSampling: 'first-last' })).pages.map((p) => p.page),
    ).toEqual([1]);
  });
  it('closes on runtime error, oversized response and cancellation without leaking errors', async () => {
    const h = harness();
    h.page.evaluate.mockRejectedValue(new Error('private upstream content'));
    await expect(h.run()).rejects.toMatchObject({
      category: 'parse_changed',
      message: 'Kuaishou official runtime call failed.',
    });
    expect(h.page.close).toHaveBeenCalledOnce();
    const large = harness('kuaishou.social', { maximumResponseBytes: 1 });
    await expect(large.run()).rejects.toMatchObject({ category: 'parse_changed' });
    expect(large.page.close).toHaveBeenCalledOnce();
    const aborted = harness('kuaishou.social', { signal: AbortSignal.abort() });
    await expect(aborted.run()).rejects.toMatchObject({ category: 'temporary' });
    expect(aborted.page.goto).not.toHaveBeenCalled();
    expect(aborted.page.close).toHaveBeenCalledOnce();
  });
  it('rejects wrong request identity before navigation', async () => {
    const h = harness('kuaishou.social', { url: 'https://example.com/' });
    await expect(h.run()).rejects.toMatchObject({ category: 'parse_changed' });
    expect(h.page.goto).not.toHaveBeenCalled();
  });
  it('requires original fixed module and uses a fixed operation/parameter allowlist', async () => {
    vi.stubGlobal('webpackJsonp', []);
    vi.stubGlobal('__jobhunterKuaishouRequire', undefined);
    vi.stubGlobal('__jobhunterKuaishouApi', undefined);
    expect(kuaishouRuntimeReady()).toBe(false);
    await expect(
      invokeKuaishouRuntime({
        campus: false,
        operation: 'list',
        pageNum: 1,
        pageSize: 50,
        nature: 'C001',
      }),
    ).rejects.toThrow('bridge changed');
    const call = vi.fn().mockResolvedValue({ code: 0 });
    vi.stubGlobal('__jobhunterKuaishouApi', { positionSimpleUsingGET: call });
    await invokeKuaishouRuntime({
      campus: false,
      operation: 'list',
      pageNum: 2,
      pageSize: 50,
      nature: 'C001',
    });
    expect(call).toHaveBeenLastCalledWith({
      pageNum: 2,
      pageSize: 50,
      positionNatureCode: 'C001',
      recruitProject: 'socialr',
    });
    await invokeKuaishouRuntime({
      campus: false,
      operation: 'list',
      pageNum: 3,
      pageSize: 50,
      nature: 'C002',
    });
    expect(call).toHaveBeenLastCalledWith({ pageNum: 3, pageSize: 50, positionNatureCode: 'C002' });
    await expect(invokeKuaishouRuntime({ campus: false, operation: 'projects' })).rejects.toThrow(
      'Unsupported',
    );
    await expect(
      invokeKuaishouRuntime({ campus: true, operation: 'list', pageNum: 1, pageSize: 50 }),
    ).rejects.toThrow('project is required');
  });
});
