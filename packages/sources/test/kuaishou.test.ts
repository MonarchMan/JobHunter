import { readFile } from 'node:fs/promises';
import { parseId } from '@jobhunter/domain';
import {
  collectDiscovery,
  defineSourceContractSuite,
  type DiscoverContext,
  type SourcePageCollection,
} from '@jobhunter/source-core';
import { describe, expect, it, vi } from 'vitest';
import {
  createKuaishouAdapter,
  kuaishouConfigSchema,
  kuaishouDefinitions,
  kuaishouSite,
  parseKuaishouDictionaries,
  parseKuaishouPage,
  selectKuaishouProject,
  validateKuaishouCollection,
  type KuaishouConfig,
  type KuaishouKey,
} from '../src/index.js';

const fixtureText = await readFile(
  new URL('./fixtures/kuaishou/jobs.json', import.meta.url),
  'utf8',
);
const fixtures = JSON.parse(fixtureText) as Record<string, unknown>[];
const keys = Object.keys(kuaishouDefinitions) as KuaishouKey[];
const dictionaries = {
  workLocation: [{ code: 'beijing', name: '北京' }],
  positionExperience: [{ code: 'EXP', name: '三年以上' }],
  positionCategory: [{ code: 'TECH', name: '研发' }],
};
/** 公开身份样本配合合成正文，覆盖协议而不依赖网络。 */
function raw(key: KuaishouKey): Record<string, unknown> {
  return {
    ...fixtures.find((item) => item.key === key),
    description: '合成测试职责',
    positionDemand: '合成测试要求',
    positionCategoryCode: 'TECH',
    workExperienceCode: 'EXP',
  };
}
/** 模拟官网 envelope，pages 故意错误，防止依赖冗余页数。 */
function envelope(
  list: unknown[],
  total = list.length,
  pageNum = 1,
  pageSize = 1,
): {
  code: number;
  result: { list: unknown[]; total: number; pageNum: number; pageSize: number; pages: number };
} {
  return { code: 0, result: { list, total, pageNum, pageSize, pages: 0 } };
}
/** 生成两页完整集合，第二条使用显式合成 ID。 */
function collection(key: KuaishouKey): SourcePageCollection {
  const job = parseKuaishouPage(
    envelope([raw(key)]),
    key,
    1,
    1,
    dictionaries,
    String(raw(key).recruitSubProjectCode),
  ).records[0];
  if (!job) throw new Error('Missing fixture.');
  return {
    coverage: 'complete',
    pages: [1, 2].map((number) => ({
      page: number,
      url: kuaishouSite(key).entry,
      total: 2,
      capturedAt: 0,
      records: [{ ...job, id: number === 1 ? job.id : '900000001' }],
    })),
  };
}
/** 注入离线采集，不允许裸 HTTP 或真实页面访问。 */
function context(key: KuaishouKey, value = collection(key)): DiscoverContext<KuaishouConfig> {
  return {
    companyId: parseId('018f0000-0000-7000-8000-000000000116', 'Company'),
    sourceId: parseId('018f0000-0000-7000-8000-000000000250', 'JobSource'),
    requestId: key,
    config: kuaishouConfigSchema.parse({ pageSize: 1 }),
    cursor: null,
    signal: new AbortController().signal,
    timeoutMs: 1000,
    http: { request: () => Promise.reject(new Error('No offline HTTP.')) },
    page: {
      snapshot: () => Promise.reject(new Error('No offline navigation.')),
      collect: vi.fn().mockResolvedValue(value),
    },
  };
}

describe('Kuaishou physical source contracts (SWT-009..011)', () => {
  for (const key of keys) {
    it(`${key} passes shared contract, normalization and one-page health`, async () => {
      const adapter = createKuaishouAdapter(key);
      const ctx = context(key);
      const first = collection(key).pages[0]?.records[0];
      if (!first) throw new Error('Missing fixture.');
      const discovered = {
        externalJobId: String(first.id),
        sourceUrl: `${kuaishouSite(key).detail}${String(first.id)}`,
        raw: first,
      };
      for (const test of defineSourceContractSuite(() => createKuaishouAdapter(key), {
        context: ctx,
        expectedExternalJobIds: [String(first.id), '900000001'],
        expectedCoverage: 'complete',
        normalizationCases: [{ discovered, detail: null }],
        fixtureText,
      }))
        await test.run();
      const normalized = await adapter.normalize({ discovered, detail: null }, ctx);
      expect(normalized.job.recruitmentCategory).toBe(
        key.includes('intern') ? 'internship' : key === 'kuaishou.social' ? 'social' : 'campus',
      );
      expect(normalized.job.locations).toContain('北京');
      expect(normalized.job.description).toBe('工作职责\n合成测试职责\n\n工作要求\n合成测试要求');
      expect(normalized.job.publishedAt).toBeNull();
      expect((await adapter.healthCheck(ctx)).status).toBe('healthy');
      expect(ctx.page?.collect).toHaveBeenLastCalledWith(
        expect.objectContaining({
          maximumPages: 1,
          minimumRequestIntervalMs: 5000,
          responseShape: 'kuaishou-jobs',
        }),
      );
      const { page: ignored, ...without } = ctx;
      expect(ignored).toBeDefined();
      await expect(async () => collectDiscovery(adapter.discover(without))).rejects.toMatchObject({
        category: 'access_blocked',
      });
      expect((await adapter.healthCheck(without)).errorCategory).toBe('access_blocked');
    });
    it.each(['duplicate', 'short', 'missing', 'total', 'page'])(
      `${key} rejects complete coverage for %s`,
      async (kind) => {
        const original = collection(key);
        const first = original.pages[0];
        const last = original.pages[1];
        if (!first || !last) throw new Error('Missing fixture.');
        const pages =
          kind === 'missing'
            ? [last]
            : [
                first,
                {
                  ...last,
                  ...(kind === 'duplicate' ? { records: first.records } : {}),
                  ...(kind === 'short' ? { records: [] } : {}),
                  ...(kind === 'total' ? { total: 3 } : {}),
                  ...(kind === 'page' ? { page: 1 } : {}),
                },
              ];
        expect(
          (
            await collectDiscovery(
              createKuaishouAdapter(key).discover(context(key, { ...original, pages })),
            )
          ).completion.coverage,
        ).toBe('partial');
      },
    );
    it(`${key} preserves sampled coverage and verified zero`, () => {
      expect(
        validateKuaishouCollection(
          {
            ...collection(key),
            coverage: 'partial',
            diagnostics: { reason: 'sampled_pages', retryable: false },
          },
          key,
          1,
        ).coverage,
      ).toBe('partial');
      expect(
        validateKuaishouCollection(
          {
            coverage: 'complete',
            pages: [
              { page: 1, records: [], total: 0, url: kuaishouSite(key).entry, capturedAt: 0 },
            ],
          },
          key,
          1,
        ).coverage,
      ).toBe('complete');
      expect(() =>
        validateKuaishouCollection({ coverage: 'complete', pages: [] }, key, 1),
      ).toThrow();
    });
  }

  it('does not persist unrelated fields and rejects wrong channel, project, page or dictionary', () => {
    const value = { ...raw('kuaishou.social'), internalSecret: 'never persist' };
    const parsed = parseKuaishouPage(envelope([value]), 'kuaishou.social', 1, 1, dictionaries);
    expect(parsed.records[0]).not.toHaveProperty('internalSecret');
    expect(parsed.records[0]?.experienceText).toBe('三年以上');
    expect(() =>
      parseKuaishouPage(envelope([value]), 'kuaishou.intern', 1, 1, dictionaries),
    ).toThrow();
    expect(() =>
      parseKuaishouPage(
        envelope([raw('kuaishou.campus')]),
        'kuaishou.campus',
        1,
        1,
        {},
        'wrong-project',
      ),
    ).toThrow();
    expect(() =>
      parseKuaishouPage(envelope([value]), 'kuaishou.social', 2, 1, dictionaries),
    ).toThrow();
    expect(() => parseKuaishouPage(envelope([value]), 'kuaishou.social', 1, 1, {})).toThrow();
    expect(() =>
      parseKuaishouPage({ code: 1, result: { total: 0, list: [] } }, 'kuaishou.social', 1, 1),
    ).toThrow();
    expect(() => parseKuaishouPage('<html>verification</html>', 'kuaishou.social', 1, 1)).toThrow();
    expect(parseKuaishouDictionaries({ code: 0, result: dictionaries })).toEqual(dictionaries);
    expect(() => kuaishouConfigSchema.parse({ pageSize: 101 })).toThrow();
    expect(() => kuaishouConfigSchema.parse({ keyword: '研发' })).toThrow();
    expect(() => kuaishouSite('kuaishou.unknown')).toThrow();
  });

  it('selects current campus year per type and fails on incomplete, missing or ambiguous projects', () => {
    const projects = [
      { code: 'old', year: '2026', active: true, projectType: 'fulltime' },
      { code: 'graduate', year: '2027', active: true, projectType: 'fulltime' },
      { code: 'intern', year: '2027', active: true, projectType: 'intern' },
    ];
    expect(selectKuaishouProject(envelope(projects), 'fulltime')).toBe('graduate');
    expect(selectKuaishouProject(envelope(projects), 'intern')).toBe('intern');
    expect(() => selectKuaishouProject(envelope(projects, 4), 'fulltime')).toThrow();
    expect(() => selectKuaishouProject(envelope([]), 'fulltime')).toThrow();
    expect(() =>
      selectKuaishouProject(
        envelope([...projects, { ...projects[1], code: 'duplicate' }]),
        'fulltime',
      ),
    ).toThrow();
  });
});
