import { readFile } from 'node:fs/promises';
import { parseId } from '@jobhunter/domain';
import {
  collectDiscovery,
  defineSourceContractSuite,
  type DiscoverContext,
  type JobSourceAdapter,
  type SourceHttpClient,
  type SourcePageClient,
  type SourcePageCollection,
} from '@jobhunter/source-core';
import { describe, it } from 'vitest';
import {
  createAlibabaAdapter,
  createByteDanceAdapter,
  createDewuAdapter,
  createHuaweiAdapter,
  createXiaohongshuAdapter,
  scriptedConfigSchema,
  type ScriptedConfig,
} from '../src/index.js';

const companyId = parseId('018f0000-0000-7000-8000-000000000102', 'Company');
const sourceId = parseId('018f0000-0000-7000-8000-000000000202', 'JobSource');
const noHttp: SourceHttpClient = {
  request: () => Promise.reject(new Error('HTTP is not used by browser transport.')),
};

/** 构造测试输入或执行断言的辅助逻辑。 */
async function fixture(path: string): Promise<{ readonly text: string; readonly value: unknown }> {
  const text = await readFile(new URL(`./fixtures/${path}`, import.meta.url), 'utf8');
  return { text, value: JSON.parse(text) as unknown };
}

/** 构造测试输入或执行断言的辅助逻辑。 */
function context(http: SourceHttpClient, page?: SourcePageClient): DiscoverContext<ScriptedConfig> {
  return {
    companyId,
    sourceId,
    requestId: 'scripted-contract-fixture',
    config: scriptedConfigSchema.parse({ pageSize: 10 }),
    signal: new AbortController().signal,
    timeoutMs: 1_000,
    http,
    ...(page ? { page } : {}),
    cursor: null,
  };
}

/** 构造测试输入或执行断言的辅助逻辑。 */
async function runBrowserContract(
  factory: () => JobSourceAdapter<ScriptedConfig, never>,
  fixturePath: string,
): Promise<void> {
  const loaded = await fixture(fixturePath);
  const collection = loaded.value as SourcePageCollection;
  const page: SourcePageClient = {
    snapshot: () => Promise.reject(new Error('snapshot is not used by browser transport')),
    collect: () => Promise.resolve(collection),
  };
  const contractContext = context(noHttp, page);
  const discovery = await collectDiscovery(factory().discover(contractContext));
  const firstRecord = collection.pages[0]?.records[0];
  const firstId = discovery.ids[0];
  if (!firstRecord || !firstId) throw new Error('Contract fixture must contain one job.');
  const cases = defineSourceContractSuite(factory, {
    context: contractContext,
    expectedExternalJobIds: discovery.ids,
    expectedCoverage: discovery.completion.coverage,
    normalizationCases: [
      {
        discovered: {
          externalJobId: firstId,
          sourceUrl:
            typeof firstRecord.detailUrl === 'string'
              ? firstRecord.detailUrl
              : factory().metadata.canonicalEntryUrl,
          raw: firstRecord,
        },
        detail: null,
      },
    ],
    fixtureText: loaded.text,
  });
  for (const contractCase of cases) await contractCase.run();
}

describe('scripted adapters common source contract', () => {
  it('covers Alibaba campus', () =>
    runBrowserContract(createAlibabaAdapter, 'alibaba/collection.json'));

  it('covers ByteDance jobs', () =>
    runBrowserContract(createByteDanceAdapter, 'bytedance/collection.json'));

  it('covers Dewu partial duplicate handling', () =>
    runBrowserContract(createDewuAdapter, 'dewu/duplicate-collection.json'));

  it('covers Huawei campus', () =>
    runBrowserContract(createHuaweiAdapter, 'huawei/collection.json'));

  it('covers Xiaohongshu campus JSON', async () => {
    const loaded = await fixture('xiaohongshu/page-1.json');
    const http: SourceHttpClient = {
      request: (request) =>
        Promise.resolve({
          status: 200,
          url: request.url,
          headers: new Headers({ 'content-type': 'application/json' }),
          body: loaded.value,
        }),
    };
    const contractContext = context(http);
    const raw = (loaded.value as { data: { list: Record<string, unknown>[] } }).data.list[0];
    if (!raw) throw new Error('Contract fixture must contain one job.');
    const cases = defineSourceContractSuite(createXiaohongshuAdapter, {
      context: contractContext,
      expectedExternalJobIds: ['red-fixture-1'],
      expectedCoverage: 'complete',
      normalizationCases: [
        {
          discovered: {
            externalJobId: 'red-fixture-1',
            sourceUrl: createXiaohongshuAdapter().metadata.canonicalEntryUrl,
            raw,
          },
          detail: null,
        },
      ],
      fixtureText: loaded.text,
    });
    for (const contractCase of cases) await contractCase.run();
  });
});
