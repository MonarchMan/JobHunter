import { readFile } from 'node:fs/promises';
import { parseId } from '@jobhunter/domain';
import type {
  DiscoverContext,
  DiscoveryEvent,
  SourceHttpClient,
  SourcePageCollection,
  SourcePageClient,
} from '@jobhunter/source-core';
import { describe, expect, it } from 'vitest';
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

/** 构造测试输入或执行断言的辅助逻辑。 */
async function collectionFixture(
  company: string,
  name = 'collection.json',
): Promise<SourcePageCollection> {
  return JSON.parse(
    await readFile(new URL(`./fixtures/${company}/${name}`, import.meta.url), 'utf8'),
  ) as SourcePageCollection;
}

/** 构造测试输入或执行断言的辅助逻辑。 */
function context(
  http: SourceHttpClient,
  config: ScriptedConfig,
  page?: SourcePageClient,
): DiscoverContext<ScriptedConfig> {
  return {
    sourceId,
    companyId,
    requestId: 'scripted-fixture',
    config,
    signal: new AbortController().signal,
    timeoutMs: 1_000,
    http,
    ...(page ? { page } : {}),
    cursor: null,
  };
}

describe('script-reference source adapters', () => {
  it('collects Alibaba campus records and normalizes provider fields', async () => {
    const collection = await collectionFixture('alibaba');
    const page: SourcePageClient = {
      snapshot: () => Promise.reject(new Error('snapshot is not used by browser transport')),
      collect: () => Promise.resolve(collection),
    };
    const http: SourceHttpClient = {
      request: () => Promise.reject(new Error('HTTP is not used by browser transport.')),
    };
    const config = scriptedConfigSchema.parse({});
    const adapter = createAlibabaAdapter();
    const events = [];
    for await (const event of adapter.discover(context(http, config, page))) events.push(event);
    expect(events).toContainEqual({ type: 'page', page: 1, discoveredCount: 1 });
    const job = events.find(
      (event): event is Extract<DiscoveryEvent, { type: 'job' }> => event.type === 'job',
    );
    if (!job) throw new Error('Fixture job was not discovered.');
    await expect(
      adapter.normalize({ discovered: job.job, detail: null }, { sourceId, companyId, config }),
    ).resolves.toMatchObject({
      job: {
        externalJobId: 'ali-fixture-1',
        title: '算法工程师-多模态大模型（T-Star Lab 日常实习）',
        locations: ['杭州市'],
        description: '参与算法项目。',
        recruitmentCategory: 'internship',
        employmentType: '实习',
        detailUrl: 'https://campus-talent.alibaba.com/campus/position/ali-fixture-1',
        applyUrl: 'https://campus-talent.alibaba.com/campus/position/ali-fixture-1',
      },
    });
  });

  it('collects Huawei campus records and normalizes internship fields', async () => {
    const collection = await collectionFixture('huawei');
    const page: SourcePageClient = {
      snapshot: () => Promise.reject(new Error('snapshot is not used by browser transport')),
      collect: () => Promise.resolve(collection),
    };
    const config = scriptedConfigSchema.parse({});
    const adapter = createHuaweiAdapter();
    const events = [];
    for await (const event of adapter.discover(
      context(
        { request: () => Promise.reject(new Error('HTTP is not used by browser transport.')) },
        config,
        page,
      ),
    )) {
      events.push(event);
    }
    const job = events.find(
      (event): event is Extract<DiscoveryEvent, { type: 'job' }> => event.type === 'job',
    );
    if (!job) throw new Error('Fixture job was not discovered.');
    await expect(
      adapter.normalize({ discovered: job.job, detail: null }, { sourceId, companyId, config }),
    ).resolves.toMatchObject({
      job: {
        externalJobId: 'hw-fixture-1',
        title: '软件开发实习生',
        locations: ['东莞', '深圳'],
        description: '参与软件研发。\n\n本科在读。',
        recruitmentCategory: 'internship',
        employmentType: '实习',
        detailUrl: 'https://career.huawei.com/cn/job-details?advertisementId=30859',
        applyUrl: 'https://career.huawei.com/cn/job-details?advertisementId=30859',
      },
    });
  });

  it('reports missing provider-issued signatures as access blocked', async () => {
    const adapter = createByteDanceAdapter();
    const config = scriptedConfigSchema.parse({});
    const http: SourceHttpClient = { request: () => Promise.reject(new Error('must not request')) };
    await expect(
      adapter.discover(context(http, config))[Symbol.asyncIterator]().next(),
    ).rejects.toMatchObject({ category: 'access_blocked' });
    await expect(adapter.healthCheck(context(http, config))).resolves.toMatchObject({
      status: 'unhealthy',
      errorCategory: 'access_blocked',
    });
  });

  it('collects browser-rendered ByteDance pages and normalizes official detail URLs', async () => {
    const collection = await collectionFixture('bytedance');
    const page: SourcePageClient = {
      snapshot: () => Promise.reject(new Error('snapshot is not used by browser transport')),
      collect: () => Promise.resolve(collection),
    };
    const adapter = createByteDanceAdapter();
    const config = scriptedConfigSchema.parse({});
    const events = [];
    for await (const event of adapter.discover(
      context(
        { request: () => Promise.reject(new Error('HTTP is not used by browser transport.')) },
        config,
        page,
      ),
    )) {
      events.push(event);
    }
    expect(events.at(-1)).toEqual({
      type: 'complete',
      coverage: 'complete',
      cursor: null,
      pages: 2,
      discoveredCount: 2,
    });
    const job = events.find(
      (event): event is Extract<DiscoveryEvent, { type: 'job' }> => event.type === 'job',
    );
    if (!job) throw new Error('Fixture job was not discovered.');
    await expect(
      adapter.normalize({ discovered: job.job, detail: null }, { sourceId, companyId, config }),
    ).resolves.toMatchObject({
      job: {
        externalJobId: 'byte-fixture-1',
        title: '算法实习生',
        recruitmentCategory: 'internship',
        detailUrl: 'https://jobs.bytedance.com/position/1001/detail',
        applyUrl: 'https://jobs.bytedance.com/position/1001/detail',
      },
    });
  });

  it('does not classify a social job as internship from description text', async () => {
    const collection: SourcePageCollection = {
      coverage: 'complete',
      pages: [
        {
          page: 1,
          url: 'https://jobs.bytedance.com/experienced/position',
          total: 1,
          capturedAt: 1,
          records: [
            {
              id: 'byte-social-1',
              title: '交换机软件工程师',
              description: '负责实现网关并指导实习生。',
              employmentType: '社招 正式',
              detailUrl: 'https://jobs.bytedance.com/experienced/position/byte-social-1/detail',
            },
          ],
        },
      ],
    };
    const page: SourcePageClient = {
      snapshot: () => Promise.reject(new Error('snapshot is not used by browser transport')),
      collect: () => Promise.resolve(collection),
    };
    const config = scriptedConfigSchema.parse({});
    const adapter = createByteDanceAdapter();
    const events = [];
    for await (const event of adapter.discover(
      context(
        { request: () => Promise.reject(new Error('HTTP is not used by browser transport.')) },
        config,
        page,
      ),
    )) {
      events.push(event);
    }
    const discovered = events.find(
      (event): event is Extract<DiscoveryEvent, { type: 'job' }> => event.type === 'job',
    );
    if (!discovered) throw new Error('Fixture job was not discovered.');
    await expect(
      adapter.normalize(
        { discovered: discovered.job, detail: null },
        { sourceId, companyId, config },
      ),
    ).resolves.toMatchObject({
      job: { recruitmentCategory: 'social', employmentType: '社招 正式' },
    });
  });

  it('marks browser discovery partial when the rendered pages repeat a stable ID', async () => {
    const collection = await collectionFixture('dewu', 'duplicate-collection.json');
    const page: SourcePageClient = {
      snapshot: () => Promise.reject(new Error('snapshot is not used by browser transport')),
      collect: () => Promise.resolve(collection),
    };
    const adapter = createDewuAdapter();
    const events = [];
    for await (const event of adapter.discover(
      context(
        { request: () => Promise.reject(new Error('HTTP is not used by browser transport.')) },
        scriptedConfigSchema.parse({}),
        page,
      ),
    )) {
      events.push(event);
    }
    expect(events.at(-1)).toMatchObject({
      type: 'complete',
      coverage: 'partial',
      discoveredCount: 1,
    });
  });

  it('requires a browser collection session for browser transport', async () => {
    const adapter = createDewuAdapter();
    const config = scriptedConfigSchema.parse({});
    const discovery = adapter.discover(
      context(
        { request: () => Promise.reject(new Error('HTTP is not used by browser transport.')) },
        config,
      ),
    );
    const iterator = discovery[Symbol.asyncIterator]();
    await expect(iterator.next()).rejects.toMatchObject({ category: 'access_blocked' });
  });

  it('rejects provider records that do not match the source-specific schema', async () => {
    const page: SourcePageClient = {
      snapshot: () => Promise.reject(new Error('snapshot is not used by browser transport')),
      collect: () =>
        Promise.resolve({
          coverage: 'complete',
          pages: [
            {
              page: 1,
              url: 'https://campus-talent.alibaba.com/campus/position?batchId=100000560002',
              total: 1,
              capturedAt: 1,
              records: [{ id: 'ali-invalid', positionName: '缺少岗位描述' }],
            },
          ],
        }),
    };
    const discovery = createAlibabaAdapter().discover(
      context(
        { request: () => Promise.reject(new Error('HTTP is not used by browser transport.')) },
        scriptedConfigSchema.parse({}),
        page,
      ),
    );
    await expect(discovery[Symbol.asyncIterator]().next()).rejects.toMatchObject({
      category: 'parse_changed',
    });
  });

  it('normalizes the anonymous Xiaohongshu campus response shape', async () => {
    const fixture = JSON.parse(
      await readFile(new URL('./fixtures/xiaohongshu/page-1.json', import.meta.url), 'utf8'),
    ) as unknown;
    const http: SourceHttpClient = {
      request: (request) =>
        Promise.resolve({
          status: 200,
          url: request.url,
          headers: new Headers({ 'content-type': 'application/json' }),
          body: fixture,
        }),
    };
    const config = scriptedConfigSchema.parse({ pageSize: 10 });
    const adapter = createXiaohongshuAdapter();
    const events = [];
    for await (const event of adapter.discover(context(http, config))) events.push(event);
    const job = events.find(
      (event): event is Extract<DiscoveryEvent, { type: 'job' }> => event.type === 'job',
    );
    if (!job) throw new Error('Fixture job was not discovered.');
    await expect(
      adapter.normalize({ discovered: job.job, detail: null }, { sourceId, companyId, config }),
    ).resolves.toMatchObject({
      job: {
        externalJobId: 'red-fixture-1',
        title: '内容运营实习生',
        locations: ['上海'],
        recruitmentCategory: 'internship',
        detailUrl: 'https://job.xiaohongshu.com/campus/position/red-fixture-1',
        applyUrl: 'https://job.xiaohongshu.com/campus/position/red-fixture-1',
      },
    });
  });
});
