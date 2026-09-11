import { parseNormalizedJob } from '@jobhunter/domain';
import {
  SourceError,
  type JobSourceAdapter,
  type SourceRequestContext,
} from '@jobhunter/source-core';
import { normalizeJobTaxonomy } from '../../shared/normalization/job-taxonomy.js';
import {
  mihoyoConfigSchema,
  parseMihoyoDetail,
  type MihoyoDetail,
  mihoyoRequest,
  mihoyoSites,
  mihoyoUrl,
  parseMihoyoJob,
  parseMihoyoPage,
  type MihoyoConfig,
  type MihoyoKey,
} from './protocol.js';

/** 三分区共享 HTTP 协议，但保持独立的来源身份、分页和缺失状态。 */
export function createMihoyoAdapter(key: MihoyoKey): JobSourceAdapter<MihoyoConfig, MihoyoDetail> {
  const site = mihoyoSites[key];
  /** 所有请求经过来源 HTTP 限流门；无浏览器 fallback 或自动认证。 */
  const read = async (
    context: SourceRequestContext<MihoyoConfig>,
    page: number,
  ): Promise<ReturnType<typeof parseMihoyoPage>> =>
    parseMihoyoPage(
      (await context.http.request(mihoyoRequest(key, context, page))).body,
      key,
      page,
    );
  return {
    metadata: {
      key,
      version: '1.0.0',
      company: { slug: 'mihoyo', name: '米哈游' },
      recruitmentType: site.channel === 'intern' ? 'mixed' : site.channel,
      canonicalEntryUrl: mihoyoUrl(key),
      officialHosts: ['jobs.mihoyo.com', 'ats.openout.mihoyo.com'],
      capabilities: { detail: 'required', pagination: 'page', transport: 'json' },
      defaultRateLimit: { requestsPerMinute: 12, burst: 1 },
      externalIdFingerprintVersion: null,
    },
    configSchema: mihoyoConfigSchema,
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
          throw new SourceError('temporary', 'Mihoyo discovery was aborted.');
        const value = page === 1 ? first : await read(context, page);
        totalChanged ||= value.total !== total;
        invalid ||= value.records.length !== Math.min(10, Math.max(0, total - (page - 1) * 10));
        for (const job of value.records) {
          if (ids.has(job.id)) {
            duplicateIds += 1;
            continue;
          }
          ids.add(job.id);
          yield {
            type: 'job',
            job: { externalJobId: job.id, sourceUrl: mihoyoUrl(key, job.id), raw: job },
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
    async fetchDetail(job, context) {
      // 1、列表身份不能被调用方篡改；2、真实详情在应用事务之外取得。
      const listed = parseMihoyoJob(job.raw, key);
      if (listed.id !== job.externalJobId)
        throw new SourceError('parse_changed', 'Mihoyo discovered identity differs.');
      return parseMihoyoDetail(
        (await context.http.request(mihoyoRequest(key, context, 1, listed.id))).body,
        key,
        listed.id,
      );
    },
    normalize(input, context) {
      // 1、required 正文缺失必须失败；2、重新校验详情归属；3、按官方字段规范化。
      const job = parseMihoyoDetail(
        { code: 0, success: true, data: input.detail },
        key,
        input.discovered.externalJobId,
      );
      const taxonomy = normalizeJobTaxonomy(`${job.competencyType} ${job.title}`);
      const url = mihoyoUrl(key, job.id);
      return Promise.resolve({
        job: parseNormalizedJob({
          companyId: context.companyId,
          sourceId: context.sourceId,
          externalJobId: job.id,
          title: job.title,
          department: null,
          jobFamily: taxonomy.jobFamily,
          jobSubfamily: taxonomy.jobSubfamily,
          recruitmentCategory: site.channel === 'intern' ? 'internship' : site.channel,
          locations: [...new Set(job.addressDetailList.map((v) => v.addressDetail))],
          employmentType: job.jobNature,
          experienceText: null,
          educationText: null,
          description: `工作职责\n${job.description}\n\n任职要求\n${job.jobRequire}`,
          detailUrl: url,
          applyUrl: url,
          publishedAt: null,
        }),
        provenance: {
          title: '$.title',
          description: '$.description + $.jobRequire',
          locations: '$.addressDetailList[].addressDetail',
          recruitmentCategory: '$.hireType + $.jobNatureId',
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
            : new SourceError('temporary', 'Mihoyo health check failed.');
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
