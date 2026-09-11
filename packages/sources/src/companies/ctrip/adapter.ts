import { parseNormalizedJob, utcInstant } from '@jobhunter/domain';
import {
  SourceError,
  type JobSourceAdapter,
  type SourceRequestContext,
} from '@jobhunter/source-core';
import { normalizeJobTaxonomy } from '../../shared/normalization/job-taxonomy.js';
import {
  ctripConfigSchema,
  ctripDescription,
  ctripPublishedAt,
  ctripRequest,
  ctripSites,
  ctripUrl,
  parseCtripJob,
  parseCtripPage,
  type CtripConfig,
  type CtripKey,
} from './protocol.js';

/** 三分区共享 HTTP 协议，但保持独立的来源身份、分页和缺失状态。 */
export function createCtripAdapter(key: CtripKey): JobSourceAdapter<CtripConfig, never> {
  const site = ctripSites[key];
  /** 所有请求经过来源 HTTP 限流门；无浏览器 fallback 或自动认证。 */
  const read = async (
    context: SourceRequestContext<CtripConfig>,
    page: number,
  ): Promise<ReturnType<typeof parseCtripPage>> =>
    parseCtripPage((await context.http.request(ctripRequest(key, context, page))).body, key);
  return {
    metadata: {
      key,
      version: '1.0.0',
      company: { slug: 'ctrip', name: '携程' },
      recruitmentType: site.channel === 'intern' ? 'mixed' : site.channel,
      canonicalEntryUrl: ctripUrl(key),
      officialHosts: ['careers.ctrip.com'],
      capabilities: { detail: 'inline', pagination: 'page', transport: 'json' },
      defaultRateLimit: { requestsPerMinute: 12, burst: 1 },
      externalIdFingerprintVersion: null,
    },
    configSchema: ctripConfigSchema,
    async *discover(context) {
      // 1、首页决定页数和有限计划；显式采样不会被当作全量。
      const first = await read(context, 1);
      const total = first.total;
      const expectedPages = Math.max(1, Math.ceil(total / 10));
      const maximum = context.config.maximumPages;
      const sampled =
        context.config.pageSampling === 'first-last' && expectedPages > maximum && maximum >= 2;
      const numbers = sampled
        ? [1, ...(maximum >= 3 ? [Math.ceil(expectedPages / 2)] : []), expectedPages]
        : Array.from({ length: Math.min(expectedPages, maximum) }, (_, i) => i + 1);
      const ids = new Set<string>();
      let duplicateIds = 0;
      let totalChanged = false;
      let invalid = false;
      // 2、逐页串行检查真实边界；异常记录不能通过去重掩盖完整性缺口。
      for (const page of numbers) {
        if (context.signal.aborted)
          throw new SourceError('temporary', 'Ctrip discovery was aborted.');
        const value = page === 1 ? first : await read(context, page);
        totalChanged ||= value.total !== total;
        invalid ||= value.records.length !== Math.min(10, Math.max(0, total - (page - 1) * 10));
        for (const job of value.records) {
          if (ids.has(job.fromId)) {
            duplicateIds += 1;
            continue;
          }
          ids.add(job.fromId);
          yield {
            type: 'job',
            job: { externalJobId: job.fromId, sourceUrl: ctripUrl(key, job.fromId), raw: job },
          };
        }
        yield { type: 'page', page, discoveredCount: ids.size };
      }
      // 3、只有页数、总数、页长及唯一 ID 闭合才能执行后续缺失判断。
      const reason = totalChanged
        ? 'pagination_total_changed'
        : duplicateIds
          ? 'duplicate_job_ids'
          : invalid
            ? 'invalid_page_boundary'
            : numbers.length < expectedPages
              ? sampled
                ? 'sampled_pages'
                : 'maximum_pages_reached'
              : ids.size !== total
                ? 'discovered_count_mismatch'
                : null;
      yield {
        type: 'complete',
        coverage: reason ? 'partial' : 'complete',
        cursor: null,
        pages: numbers.length,
        discoveredCount: ids.size,
        diagnostics: {
          reason,
          retryable: totalChanged,
          expectedCount: total,
          discoveredCount: ids.size,
          expectedPages,
          fetchedPages: numbers.length,
          duplicateIds,
          totalChanged,
        },
      };
    },
    normalize(input, context) {
      // 1、重新校验身份及白名单；2、仅从公开字段归一化，不从标题推测地点。
      const job = parseCtripJob(input.discovered.raw, key);
      if (job.fromId !== input.discovered.externalJobId)
        throw new SourceError('parse_changed', 'Ctrip normalized identity differs.');
      const taxonomy = normalizeJobTaxonomy(`${job.jobFamilyGroupName ?? ''} ${job.jobTitle}`);
      const url = ctripUrl(key, job.fromId);
      return Promise.resolve({
        job: parseNormalizedJob({
          companyId: context.companyId,
          sourceId: context.sourceId,
          externalJobId: job.fromId,
          title: job.jobTitle,
          department: job.buName ?? null,
          jobFamily: taxonomy.jobFamily,
          jobSubfamily: taxonomy.jobSubfamily,
          recruitmentCategory: site.channel === 'intern' ? 'internship' : site.channel,
          locations: job.cityName?.trim() ? [job.cityName.trim()] : [],
          employmentType: site.channel === 'intern' ? '实习' : '全职',
          experienceText: null,
          educationText: null,
          description: ctripDescription(job),
          detailUrl: url,
          applyUrl: url,
          publishedAt: utcInstant(ctripPublishedAt(job.publishDate)),
        }),
        provenance: {
          title: '$.jobTitle',
          description: '$.duty + $.requirements',
          locations: '$.cityName (language=zh-CN)',
          recruitmentCategory: '$.category + $.kind',
          publishedAt: '$.publishDate (Asia/Shanghai)',
        },
        sourcePrivateJson: {},
      });
    },
    async healthCheck(context) {
      const start = Date.now();
      try {
        const value = await read(context, 1);
        const ok = value.total > 0 && value.records.length === Math.min(10, value.total);
        return {
          status: ok ? 'healthy' : 'degraded',
          checkedAt: Date.now(),
          latencyMs: Date.now() - start,
          signals: [
            { key: 'public_list', ok, diagnostic: ok ? null : 'No jobs or incomplete first page.' },
          ],
          errorCategory: null,
        };
      } catch (error) {
        const e =
          error instanceof SourceError
            ? error
            : new SourceError('temporary', 'Ctrip health check failed.');
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
