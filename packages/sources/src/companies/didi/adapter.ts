import { parseNormalizedJob, utcInstant } from '@jobhunter/domain';
import {
  SourceError,
  type JobSourceAdapter,
  type SourceRequestContext,
  type SourcePageCollection,
  type SourcePageCollectionRequest,
} from '@jobhunter/source-core';
import { normalizeJobTaxonomy } from '../../shared/normalization/job-taxonomy.js';
import {
  didiConfigSchema,
  didiSites,
  didiPageNumbers,
  parseDidiJob,
  parseDidiPage,
  parseDidiDetail,
  validateDidiCollection,
  type DidiKey,
  type DidiConfig,
  type DidiJob,
} from './protocol.js';

/** 基于固定路径构造匿名社招 HTTP 请求，不附带登录或风控凭据。 */
async function socialRequest(
  context: SourceRequestContext<DidiConfig>,
  path: string,
): Promise<unknown> {
  const response = await context.http.request({
    sourceKey: 'didi.social',
    requestId: context.requestId,
    url: `https://talent.didiglobal.com${path}`,
    allowedHosts: ['talent.didiglobal.com'],
    signal: context.signal,
    timeoutMs: context.timeoutMs,
    responseType: 'json',
  });
  return response.body;
}
/** 浏览器请求由中立契约交给 Worker，列表与单条详情身份严格分开。 */
function browserRequest(
  key: DidiKey,
  context: SourceRequestContext<DidiConfig>,
  id?: string,
): SourcePageCollectionRequest {
  const site = didiSites[key];
  return {
    sourceKey: key,
    requestId: context.requestId,
    url: id ? `${site.detail}${id}` : site.entry,
    allowedHosts: [site.host],
    signal: context.signal,
    timeoutMs: 30000,
    operationTimeoutMs: 300000,
    maximumPages: id ? 1 : context.config.maximumPages,
    pageSize: site.pageSize,
    pageSampling: context.config.pageSampling,
    minimumRequestIntervalMs: 5000,
    maximumResponseBytes: 2 * 1024 * 1024,
    listEndpointPath: id
      ? '/api/outer/ats-apply/website/job'
      : '/api/outer/ats-apply/website/jobs/v2',
    responseShape: id ? 'didi-moka-detail' : 'didi-moka',
  };
}
/** 三渠道共享生产编排，物理来源仍独立采集、去重与记录缺失状态。 */
export function createDidiAdapter(key: DidiKey): JobSourceAdapter<DidiConfig, DidiJob> {
  const site = didiSites[key];
  /** 列表采集：社招匿名 HTTP，Moka 使用原始客户端；所有出口校验完整性。 */
  const collect = async (
    context: SourceRequestContext<DidiConfig>,
    health = false,
  ): Promise<SourcePageCollection> => {
    if (key !== 'didi.social') {
      if (!context.page?.collect)
        throw new SourceError('access_blocked', 'Didi Moka requires an anonymous browser.');
      return validateDidiCollection(
        await context.page.collect({
          ...browserRequest(key, context),
          ...(health ? { maximumPages: 1 } : {}),
        }),
        key,
        site.pageSize,
      );
    }
    // 1、始终从配置容量首页确认总数，禁止额外的地点/职位过滤。
    const pages: SourcePageCollection['pages'][number][] = [];
    const read = async (page: number): Promise<number> => {
      const path = `/recruit-portal-service/api/job/front/list?page=${String(page)}&recruitType=1&size=16`;
      const parsed = parseDidiPage(await socialRequest(context, path), key, page);
      pages.push({
        page,
        url: site.entry,
        records: parsed.records,
        total: parsed.total,
        capturedAt: Date.now(),
      });
      return parsed.total;
    };
    const total = await read(1);
    const numbers = didiPageNumbers(
      total,
      16,
      health ? 1 : context.config.maximumPages,
      context.config.pageSampling,
    );
    // 2、请求由 SourceHttpClient 的来源限流门控制；逐页串行而非并发扫描。
    for (const page of numbers.slice(1)) {
      if (context.signal.aborted) throw new SourceError('temporary', 'Didi discovery was aborted.');
      await read(page);
    }
    const partial = numbers.length < Math.max(1, Math.ceil(total / 16));
    return validateDidiCollection(
      {
        pages,
        coverage: partial ? 'partial' : 'complete',
        diagnostics: {
          reason: partial
            ? context.config.pageSampling === 'first-last'
              ? 'sampled_pages'
              : 'maximum_pages_reached'
            : null,
          retryable: false,
        },
      },
      key,
      16,
    );
  };
  return {
    metadata: {
      key,
      version: '1.0.0',
      company: { slug: 'didi', name: '滴滴' },
      recruitmentType: site.channel === 'intern' ? 'mixed' : site.channel,
      canonicalEntryUrl: site.entry,
      officialHosts: [site.host],
      capabilities: {
        detail: site.channel === 'campus' ? 'inline' : 'required',
        pagination: 'page',
        transport: key === 'didi.social' ? 'json' : 'browser',
      },
      defaultRateLimit: { requestsPerMinute: 12, burst: 1 },
      externalIdFingerprintVersion: null,
    },
    configSchema: didiConfigSchema(key),
    async *discover(context) {
      // 1、先验证集合，才能输出发现事件；2、去重后透传 partial 原因。
      const value = await collect(context);
      const ids = new Set<string>();
      let paused = 0;
      for (const page of value.pages) {
        for (const raw of page.records) {
          const job = parseDidiJob(raw, key);
          // 1.a、暂停记录参与原始分页校验，但不作为在招岗位入库；仅完整集合可推导在招总数。
          if (job.status === 'pause') {
            paused += 1;
            continue;
          }
          if (ids.has(job.id)) continue;
          ids.add(job.id);
          yield {
            type: 'job',
            job: { externalJobId: job.id, sourceUrl: `${site.detail}${job.id}`, raw: job },
          };
        }
        yield { type: 'page', page: page.page, discoveredCount: ids.size };
      }
      yield {
        type: 'complete',
        coverage: value.coverage,
        cursor: null,
        pages: value.pages.length,
        discoveredCount: ids.size,
        ...(value.diagnostics
          ? {
              diagnostics: {
                ...value.diagnostics,
                discoveredCount: ids.size,
                expectedCount: paused
                  ? value.coverage === 'complete'
                    ? ids.size
                    : null
                  : (value.diagnostics.expectedCount ?? null),
              },
            }
          : {}),
      };
    },
    ...(site.channel === 'campus'
      ? {}
      : {
          fetchDetail: async (job, context) => {
            const listed = parseDidiJob(job.raw, key);
            if (listed.id !== job.externalJobId)
              throw new SourceError('parse_changed', 'Didi discovered identity differs.');
            if (key === 'didi.social')
              return parseDidiDetail(
                await socialRequest(
                  context,
                  `/recruit-portal-service/api/job/front/view/${listed.id}`,
                ),
                key,
                listed,
              );
            if (!context.page?.collect)
              throw new SourceError(
                'access_blocked',
                'Didi Moka detail requires an anonymous browser.',
              );
            const result = await context.page.collect(browserRequest(key, context, listed.id));
            if (
              result.coverage !== 'complete' ||
              result.pages.length !== 1 ||
              result.pages[0]?.total !== 1 ||
              result.pages[0].records.length !== 1
            )
              throw new SourceError('parse_changed', 'Didi detail collection is incomplete.');
            const detail = parseDidiJob(result.pages[0].records[0], key);
            if (detail.status !== 'open') throw new SourceError('not_found', 'Didi job is paused.');
            if (detail.id !== listed.id || !detail.description)
              throw new SourceError('parse_changed', 'Didi detail identity or body changed.');
            return detail;
          },
        }),
    normalize(input, context) {
      // 1、延迟正文缺失必须失败，不能用列表标题生成占位描述。
      const job = parseDidiJob(input.detail ?? input.discovered.raw, key);
      if (job.status !== 'open') throw new SourceError('not_found', 'Didi job is paused.');
      if (job.id !== input.discovered.externalJobId || !job.description)
        throw new SourceError(
          'parse_changed',
          'Didi normalization requires matching public detail.',
        );
      const taxonomy = normalizeJobTaxonomy(job.taxonomy ?? job.title);
      const url = `${site.detail}${job.id}`;
      // 2、官方未提供地点时保留空数组，不推测城市；日期明确使用来源语义。
      return Promise.resolve({
        job: parseNormalizedJob({
          companyId: context.companyId,
          sourceId: context.sourceId,
          externalJobId: job.id,
          title: job.title,
          department: job.department,
          jobFamily: taxonomy.jobFamily,
          jobSubfamily: taxonomy.jobSubfamily,
          recruitmentCategory: site.channel === 'intern' ? 'internship' : site.channel,
          locations: job.locations,
          employmentType: site.channel === 'intern' ? '实习' : '全职',
          experienceText: null,
          educationText: job.education,
          description: job.description,
          detailUrl: url,
          applyUrl: url,
          publishedAt: job.publishedAt === null ? null : utcInstant(job.publishedAt),
        }),
        provenance: {
          title: key === 'didi.social' ? '$.jobName' : '$.title',
          description: key === 'didi.social' ? '$.jobDesc + $.qualification' : '$.jobDescription',
          recruitmentCategory: 'official site + record recruitment type',
        },
        sourcePrivateJson: {},
      });
    },
    async healthCheck(context) {
      const start = Date.now();
      try {
        const value = await collect(context, true);
        const ok = value.pages.some((p) =>
          p.records.some((r) => parseDidiJob(r, key).status === 'open'),
        );
        return {
          status: ok ? 'healthy' : 'degraded',
          checkedAt: Date.now(),
          latencyMs: Date.now() - start,
          signals: [{ key: 'public_list', ok, diagnostic: ok ? null : 'No public jobs.' }],
          errorCategory: null,
        };
      } catch (error) {
        const e =
          error instanceof SourceError
            ? error
            : new SourceError('temporary', 'Didi health check failed.');
        return {
          status: 'unhealthy',
          checkedAt: Date.now(),
          latencyMs: Date.now() - start,
          signals: [{ key: 'public_list', ok: false, diagnostic: e.safeDiagnostic }],
          errorCategory: e.category,
        };
      }
    },
  };
}
