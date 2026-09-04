import { readFile } from 'node:fs/promises';
import { parseId } from '@jobhunter/domain';
import {
  collectDiscovery,
  defineSourceContractSuite,
  type DiscoverContext,
  type DiscoveredJob,
  type JobSourceAdapter,
  type SourceHttpClient,
  type SourcePageCollection,
} from '@jobhunter/source-core';
import { describe, expect, it } from 'vitest';
import {
  createNeteaseAdapter,
  createNeteaseInternAdapter,
  createNeteaseSocialAdapter,
  createOppoInternAdapter,
  createQihoo360SocialAdapter,
  createVivoSocialAdapter,
  createVivoCampusAdapter,
  createVivoInternAdapter,
  createXiaomiInternAdapter,
  neteaseConfigSchema,
  oppoInternConfigSchema,
  qihoo360ConfigSchema,
  vivoSocialConfigSchema,
  vivoCampusConfigSchema,
  xiaomiInternConfigSchema,
} from '../../src/index.js';

const companyId = parseId('018f0000-0000-7000-8000-000000000111', 'Company');
const sourceId = parseId('018f0000-0000-7000-8000-000000000214', 'JobSource');

/** 构造测试输入或执行断言的辅助逻辑。 */
async function fixture(path: string): Promise<unknown> {
  return JSON.parse(
    await readFile(new URL(`../fixtures/${path}`, import.meta.url), 'utf8'),
  ) as unknown;
}

/** 构造测试输入或执行断言的辅助逻辑。 */
async function fixtureText(path: string): Promise<string> {
  return readFile(new URL(`../fixtures/${path}`, import.meta.url), 'utf8');
}

/** 构造测试输入或执行断言的辅助逻辑。 */
function http(body: unknown): SourceHttpClient {
  return {
    request: (request) =>
      Promise.resolve({
        status: 200,
        url: request.url,
        headers: new Headers({ 'content-type': 'application/json' }),
        body: body as never,
      }),
  };
}

/** 构造测试输入或执行断言的辅助逻辑。 */
function httpSequence(bodies: readonly unknown[]): SourceHttpClient {
  let index = 0;
  return {
    request: (request) => {
      const body = bodies[index];
      index += 1;
      return Promise.resolve({
        status: 200,
        url: request.url,
        headers: new Headers({ 'content-type': 'application/json' }),
        body: body as never,
      });
    },
  };
}

/** 构造测试输入或执行断言的辅助逻辑。 */
function context<TConfig>(config: TConfig, body: unknown): DiscoverContext<TConfig> {
  return {
    companyId,
    sourceId,
    requestId: 'new-source-fixture',
    config,
    cursor: null,
    signal: new AbortController().signal,
    timeoutMs: 1_000,
    http: http(body),
  };
}

/** 构造测试输入或执行断言的辅助逻辑。 */
async function discoveredJobs<TConfig>(
  adapter: JobSourceAdapter<TConfig, never>,
  discoverContext: DiscoverContext<TConfig>,
): Promise<DiscoveredJob[]> {
  const jobs: DiscoveredJob[] = [];
  for await (const event of adapter.discover(discoverContext)) {
    if (event.type === 'job') jobs.push(event.job);
  }
  return jobs;
}

/** 构造测试输入或执行断言的辅助逻辑。 */
async function runContract<TConfig>(
  factory: () => JobSourceAdapter<TConfig, never>,
  discoverContext: DiscoverContext<TConfig>,
  text: string,
): Promise<void> {
  const adapter = factory();
  const jobs = await discoveredJobs(adapter, discoverContext);
  const discovery = await collectDiscovery(adapter.discover(discoverContext));
  const first = jobs[0];
  if (!first) throw new Error('Contract fixture must contain one job.');
  const cases = defineSourceContractSuite(factory, {
    context: discoverContext,
    expectedExternalJobIds: discovery.ids,
    expectedCoverage: discovery.completion.coverage,
    normalizationCases: [{ discovered: first, detail: null }],
    fixtureText: text,
  });
  for (const contractCase of cases) await contractCase.run();
}

describe('new official source adapters', () => {
  it('passes the common source contract for all five adapters', async () => {
    const xiaomi = await fixture('xiaomi/intern/page-1.json');
    await runContract(
      createXiaomiInternAdapter,
      context(xiaomiInternConfigSchema.parse({ pageSize: 2 }), xiaomi),
      await fixtureText('xiaomi/intern/page-1.json'),
    );

    const vivo = await fixture('vivo/social/page-1.json');
    await runContract(
      createVivoSocialAdapter,
      context(vivoSocialConfigSchema.parse({ pageSize: 2 }), vivo),
      await fixtureText('vivo/social/page-1.json'),
    );

    const vivoCampus = await fixture('vivo/campus/page-1.json');
    await runContract(
      createVivoInternAdapter,
      context(vivoCampusConfigSchema.parse({ pageSize: 2 }), vivoCampus),
      await fixtureText('vivo/campus/page-1.json'),
    );

    const oppo = await fixture('oppo/intern/page-1.json');
    await runContract(
      createOppoInternAdapter,
      context(oppoInternConfigSchema.parse({ pageSize: 2 }), oppo),
      await fixtureText('oppo/intern/page-1.json'),
    );

    const netease = await fixture('netease/mixed/page-1.json');
    await runContract(
      createNeteaseSocialAdapter,
      context(neteaseConfigSchema.parse({ pageSize: 2 }), netease),
      await fixtureText('netease/mixed/page-1.json'),
    );
    await runContract(
      createNeteaseInternAdapter,
      context(neteaseConfigSchema.parse({ pageSize: 2 }), netease),
      await fixtureText('netease/mixed/page-1.json'),
    );

    const collection = (await fixture('qihoo360/social/collection.json')) as SourcePageCollection;
    const qihooConfig = qihoo360ConfigSchema.parse({});
    const qihooContext: DiscoverContext<typeof qihooConfig> = {
      ...context(qihooConfig, {}),
      page: {
        snapshot: () => Promise.reject(new Error('snapshot is not used')),
        collect: () => Promise.resolve(collection),
      },
    };
    await runContract(
      createQihoo360SocialAdapter,
      qihooContext,
      await fixtureText('qihoo360/social/collection.json'),
    );
  });

  it('normalizes Xiaomi internship jobs from the official inline JSON', async () => {
    const body = await fixture('xiaomi/intern/page-1.json');
    const adapter = createXiaomiInternAdapter();
    const config = xiaomiInternConfigSchema.parse({ pageSize: 2 });
    const ctx = context(config, body);
    const discovery = await collectDiscovery(adapter.discover(ctx));
    expect(discovery).toMatchObject({ ids: ['7559917443185379634', '7559917443185379635'] });
    expect(discovery.completion.coverage).toBe('complete');
    const [first] = await discoveredJobs(adapter, ctx);
    expect(first).toBeDefined();
    if (!first) return;
    await expect(
      adapter.normalize({ discovered: first, detail: null }, ctx),
    ).resolves.toMatchObject({
      job: { recruitmentCategory: 'internship', locations: ['北京'] },
    });
  });

  it('normalizes vivo social jobs and preserves a job-level deep link', async () => {
    const body = await fixture('vivo/social/page-1.json');
    const adapter = createVivoSocialAdapter();
    const config = vivoSocialConfigSchema.parse({ pageSize: 2 });
    const ctx = context(config, body);
    const [first] = await discoveredJobs(adapter, ctx);
    expect(first?.sourceUrl).toContain('/job-detail?');
    expect(first?.sourceUrl).toContain('_irjid=M2087541405486350338');
    if (!first) return;
    await expect(
      adapter.normalize({ discovered: first, detail: null }, ctx),
    ).resolves.toMatchObject({
      job: { recruitmentCategory: 'social', experienceText: '5年及以上' },
    });
  });

  it('normalizes vivo campus-site internships with the stable UUID deep link', async () => {
    const body = await fixture('vivo/campus/page-1.json');
    const adapter = createVivoInternAdapter();
    const config = vivoCampusConfigSchema.parse({ pageSize: 2 });
    const ctx = context(config, body);
    const [first] = await discoveredJobs(adapter, ctx);
    expect(first?.externalJobId).toBe('33572111-23f9-49bf-a0df-70f0e841ee51');
    expect(first?.sourceUrl).toContain('/intern/detail?jobAdId=');
    if (!first) return;
    await expect(
      adapter.normalize({ discovered: first, detail: null }, ctx),
    ).resolves.toMatchObject({
      job: {
        recruitmentCategory: 'internship',
        locations: ['广东省·深圳市'],
        employmentType: '实习',
      },
    });
  });

  it('maps vivo campus records to the campus channel', async () => {
    const body = (await fixture('vivo/campus/page-1.json')) as {
      Data: Record<string, unknown>[];
    };
    const campusBody = {
      ...body,
      Data: body.Data.map((job) => ({
        ...job,
        Category: '应届生招聘',
        CategoryId: '2',
        JobAdName: '影像算法工程师',
      })),
    };
    const adapter = createVivoCampusAdapter();
    const config = vivoCampusConfigSchema.parse({ pageSize: 2 });
    const ctx = context(config, campusBody);
    const [first] = await discoveredJobs(adapter, ctx);
    expect(first?.sourceUrl).toContain('/campus/detail?jobAdId=');
    if (!first) return;
    await expect(
      adapter.normalize({ discovered: first, detail: null }, ctx),
    ).resolves.toMatchObject({
      job: { recruitmentCategory: 'campus', employmentType: '全职' },
    });
  });

  it('filters OPPO to project 29 and normalizes internship jobs', async () => {
    const body = await fixture('oppo/intern/page-1.json');
    const adapter = createOppoInternAdapter();
    const config = oppoInternConfigSchema.parse({ pageSize: 2 });
    const ctx = context(config, body);
    const [first] = await discoveredJobs(adapter, ctx);
    expect(first?.sourceUrl).toContain('/campus/post/1599?recruitType=Intern');
    if (!first) return;
    await expect(
      adapter.normalize({ discovered: first, detail: null }, ctx),
    ).resolves.toMatchObject({
      job: { recruitmentCategory: 'internship', employmentType: '实习生' },
    });
  });

  it('uses record-level evidence for NetEase mixed recruitment categories', async () => {
    const body = await fixture('netease/mixed/page-1.json');
    const adapter = createNeteaseAdapter();
    const config = neteaseConfigSchema.parse({ pageSize: 2 });
    const ctx = context(config, body);
    const jobs = await discoveredJobs(adapter, ctx);
    expect(jobs).toHaveLength(2);
    const normalized = await Promise.all(
      jobs.map((job) => adapter.normalize({ discovered: job, detail: null }, ctx)),
    );
    expect(normalized.map((item) => item.job.recruitmentCategory)).toEqual([
      'internship',
      'social',
    ]);
    expect(normalized[0]?.job.detailUrl).toContain('/job-detail.html?id=53708');
  });

  it('exposes NetEase internship and social records as independent sources', async () => {
    const body = await fixture('netease/mixed/page-1.json');
    const config = neteaseConfigSchema.parse({ pageSize: 2 });
    const internContext = context(config, body);
    const socialContext = context(config, body);
    const internJobs = await discoveredJobs(createNeteaseInternAdapter(), internContext);
    const socialJobs = await discoveredJobs(createNeteaseSocialAdapter(), socialContext);
    expect(internJobs.map((job) => job.externalJobId)).toEqual(['53708']);
    expect(socialJobs.map((job) => job.externalJobId)).toEqual(['60001']);
  });

  it('collects the 360 list only through the anonymous browser JSON boundary', async () => {
    const collection = (await fixture('qihoo360/social/collection.json')) as SourcePageCollection;
    const adapter = createQihoo360SocialAdapter();
    const config = qihoo360ConfigSchema.parse({});
    const ctx: DiscoverContext<typeof config> = {
      ...context(config, {}),
      page: {
        snapshot: () => Promise.reject(new Error('snapshot is not used')),
        collect: () => Promise.resolve(collection),
      },
    };
    const discovery = await collectDiscovery(adapter.discover(ctx));
    expect(discovery.ids).toEqual(['6a0d033efd5a462f18dd7632', '6a0d033efd5a462f18dd7633']);
    expect(discovery.completion.coverage).toBe('complete');
  });

  it('reports duplicate IDs as partial instead of claiming complete coverage', async () => {
    const body = (await fixture('xiaomi/intern/page-1.json')) as {
      data: { list: unknown[] };
    };
    body.data.list[1] = body.data.list[0];
    const adapter = createXiaomiInternAdapter();
    const config = xiaomiInternConfigSchema.parse({ pageSize: 2 });
    const discovery = await collectDiscovery(adapter.discover(context(config, body)));
    expect(discovery.completion).toMatchObject({
      coverage: 'partial',
      diagnostics: { reason: 'duplicate_job_ids', duplicateIds: 1 },
    });
  });

  it('reports a changing pagination total as partial', async () => {
    const first = (await fixture('xiaomi/intern/page-1.json')) as {
      data: { list: Record<string, unknown>[]; total: number };
    };
    first.data.total = 3;
    const nextJob = { ...first.data.list[0] };
    nextJob.jobId = '7559917443185264999';
    nextJob.jobPostId = '7559917443185379999';
    nextJob.url = 'https://xiaomi.jobs.f.mioffice.cn/topintern/position/7559917443185379999/detail';
    const second = structuredClone(first);
    second.data.list = [nextJob];
    second.data.total = 4;
    const config = xiaomiInternConfigSchema.parse({ pageSize: 2 });
    const discoverContext: DiscoverContext<typeof config> = {
      ...context(config, first),
      http: httpSequence([first, second]),
    };
    const discovery = await collectDiscovery(createXiaomiInternAdapter().discover(discoverContext));
    expect(discovery.completion).toMatchObject({
      coverage: 'partial',
      diagnostics: { reason: 'pagination_total_changed', totalChanged: true },
    });
  });
});
