import { parseNormalizedJob } from '@jobhunter/domain';
import {
  SourceError,
  canonicalizeOfficialUrl,
  type DiscoveryEvent,
  type JobSourceAdapter,
  type SourceHealth,
} from '@jobhunter/source-core';
import { normalizeJobTaxonomy } from '../../../shared/normalization/job-taxonomy.js';
import {
  tencentCampusConfigSchema,
  tencentCampusDetailResponseSchema,
  tencentCampusDetailSchema,
  tencentCampusListJobSchema,
  tencentCampusListResponseSchema,
  type TencentCampusConfig,
  type TencentCampusDetail,
} from './schemas.js';

const hosts = ['join.qq.com'] as const;
const entryUrl = 'https://join.qq.com/post.html';
const listEndpoint = 'https://join.qq.com/api/v1/position/searchPosition';
const detailEndpoint = 'https://join.qq.com/api/v1/jobDetails/getJobDetailsByPostId';
const internshipProjectMappingIds = [2, 104, 20] as const;
const campusProjectMappingIds = [1] as const;

interface TencentCampusVariant {
  readonly key: 'tencent.intern' | 'tencent.campus';
  readonly projectMappingIds: readonly number[];
  readonly category: 'internship' | 'campus';
}

function headers(referer = entryUrl): Readonly<Record<string, string>> {
  return { 'content-type': 'application/json', accept: 'application/json', referer };
}

function listBody(page: number, pageSize: number, projectMappingIds: readonly number[]): string {
  return JSON.stringify({
    projectIdList: [],
    projectMappingIdList: projectMappingIds,
    keyword: '',
    bgList: [],
    workCountryType: 1,
    workCityList: [],
    recruitCityList: [],
    positionFidList: [],
    pageIndex: page,
    pageSize,
  });
}

function jobUrl(postId: string): string {
  return canonicalizeOfficialUrl(
    `https://join.qq.com/post_detail.html?postid=${encodeURIComponent(postId)}`,
    hosts,
  );
}

function createTencentCampusVariant(
  variant: TencentCampusVariant,
): JobSourceAdapter<TencentCampusConfig, TencentCampusDetail> {
  return {
    metadata: {
      key: variant.key,
      version: '1.0.0',
      company: { slug: 'tencent', name: '腾讯' },
      recruitmentType: 'campus',
      canonicalEntryUrl: entryUrl,
      officialHosts: [...hosts],
      capabilities: { detail: 'deferred', pagination: 'page', transport: 'json' },
      defaultRateLimit: { requestsPerMinute: 12, burst: 1 },
      externalIdFingerprintVersion: null,
    },
    configSchema: tencentCampusConfigSchema,
    async *discover(context): AsyncIterable<DiscoveryEvent> {
      let page = 1;
      let count: number | null = null;
      let discoveredCount = 0;
      const seen = new Set<string>();
      let coverage: 'complete' | 'partial' = 'complete';
      let duplicateIds = 0;
      let totalChanged = false;
      for (;;) {
        const response = await context.http.request({
          sourceKey: variant.key,
          requestId: context.requestId,
          url: listEndpoint,
          allowedHosts: hosts,
          signal: context.signal,
          method: 'POST',
          headers: headers(),
          body: listBody(page, context.config.pageSize, variant.projectMappingIds),
          responseType: 'json',
          timeoutMs: context.timeoutMs,
        });
        const parsed = tencentCampusListResponseSchema.parse(response.body);
        count ??= parsed.data.count;
        if (count !== parsed.data.count) {
          coverage = 'partial';
          totalChanged = true;
        }
        for (const raw of parsed.data.positionList) {
          if (seen.has(raw.postId)) {
            coverage = 'partial';
            duplicateIds += 1;
            continue;
          }
          seen.add(raw.postId);
          discoveredCount += 1;
          yield {
            type: 'job',
            job: { externalJobId: raw.postId, sourceUrl: jobUrl(raw.postId), raw },
          };
        }
        yield { type: 'page', page, discoveredCount };
        if (discoveredCount >= count || parsed.data.positionList.length === 0) break;
        page += 1;
      }
      if (discoveredCount !== count) coverage = 'partial';
      yield {
        type: 'complete',
        coverage,
        cursor: null,
        pages: page,
        discoveredCount,
        diagnostics: {
          reason:
            coverage === 'complete'
              ? null
              : totalChanged
                ? 'pagination_total_changed'
                : duplicateIds > 0
                  ? 'duplicate_job_ids'
                  : 'discovered_count_mismatch',
          retryable: totalChanged,
          expectedCount: count,
          discoveredCount,
          expectedPages: Math.ceil(count / context.config.pageSize),
          fetchedPages: page,
          duplicateIds,
          totalChanged,
        },
      };
    },
    async fetchDetail(job, context) {
      const url = new URL(detailEndpoint);
      url.searchParams.set('postId', job.externalJobId);
      const response = await context.http.request({
        sourceKey: variant.key,
        requestId: context.requestId,
        url: url.toString(),
        allowedHosts: hosts,
        signal: context.signal,
        headers: headers(job.sourceUrl),
        responseType: 'json',
        timeoutMs: context.timeoutMs,
      });
      const detail = tencentCampusDetailResponseSchema.parse(response.body).data;
      if (detail.postId !== job.externalJobId)
        throw new SourceError('parse_changed', 'Tencent campus detail returned another job ID.');
      return detail;
    },
    normalize(input, context) {
      const list = tencentCampusListJobSchema.parse(input.discovered.raw);
      const detail = input.detail ? tencentCampusDetailSchema.parse(input.detail) : null;
      if (
        list.postId !== input.discovered.externalJobId ||
        (detail && list.postId !== detail.postId)
      )
        throw new SourceError('parse_changed', 'Tencent campus list/detail identity differs.');
      const taxonomy = normalizeJobTaxonomy(detail?.tidName ?? list.positionTitle);
      const locations =
        detail?.workCityList ??
        (list.workCities ?? '')
          .split(/[\s,，/]+/)
          .map((value) => value.trim())
          .filter(Boolean);
      const description = detail
        ? [
            `岗位职责\n${detail.desc}`,
            `岗位要求\n${detail.request}`,
            detail.internBonus ? `实习加分项\n${detail.internBonus}` : null,
          ]
            .filter(Boolean)
            .join('\n\n')
        : [
            `职位名称\n${list.positionTitle}`,
            `招聘项目\n${list.projectName}`,
            `招聘标签\n${list.recruitLabelName}`,
          ].join('\n\n');
      return Promise.resolve({
        job: parseNormalizedJob({
          companyId: context.companyId,
          sourceId: context.sourceId,
          externalJobId: list.postId,
          title: detail?.title ?? list.positionTitle,
          department: null,
          jobFamily: taxonomy.jobFamily,
          jobSubfamily: taxonomy.jobSubfamily,
          recruitmentCategory: variant.category,
          locations,
          employmentType: variant.category === 'internship' ? '实习' : '全职',
          experienceText: null,
          educationText: null,
          description,
          detailUrl: jobUrl(list.postId),
          applyUrl: jobUrl(list.postId),
          publishedAt: null,
        }),
        provenance: {
          title: '$.data.title',
          locations: '$.data.workCityList',
          description: '$.data.desc+$.data.request',
        },
        sourcePrivateJson: {
          projectName: detail?.projectName ?? list.projectName,
          recruitLabelName: detail?.recruitLabelName ?? list.recruitLabelName,
        },
      });
    },
    async healthCheck(context): Promise<SourceHealth> {
      const startedAt = Date.now();
      try {
        const response = await context.http.request({
          sourceKey: variant.key,
          requestId: context.requestId,
          url: listEndpoint,
          allowedHosts: hosts,
          signal: context.signal,
          method: 'POST',
          headers: headers(),
          body: listBody(1, 1, variant.projectMappingIds),
          responseType: 'json',
          timeoutMs: context.timeoutMs,
        });
        const parsed = tencentCampusListResponseSchema.parse(response.body);
        const ok = parsed.data.count > 0 && parsed.data.positionList.length > 0;
        return {
          status: ok ? 'healthy' : 'degraded',
          checkedAt: Date.now(),
          latencyMs: Date.now() - startedAt,
          signals: [
            {
              key: `anonymous_${variant.category}_list`,
              ok,
              diagnostic: ok ? null : `Tencent returned no ${variant.category} jobs.`,
            },
          ],
          errorCategory: null,
        };
      } catch (error) {
        const sourceError =
          error instanceof SourceError
            ? error
            : new SourceError('parse_changed', `Tencent ${variant.category} health check failed.`, {
                cause: error,
              });
        return {
          status: 'unhealthy',
          checkedAt: Date.now(),
          latencyMs: Date.now() - startedAt,
          signals: [
            {
              key: `anonymous_${variant.category}_list`,
              ok: false,
              diagnostic: sourceError.safeDiagnostic,
            },
          ],
          errorCategory: sourceError.category,
        };
      }
    },
  };
}

export function createTencentInternAdapter(): JobSourceAdapter<
  TencentCampusConfig,
  TencentCampusDetail
> {
  return createTencentCampusVariant({
    key: 'tencent.intern',
    projectMappingIds: internshipProjectMappingIds,
    category: 'internship',
  });
}

export function createTencentCampusAdapter(): JobSourceAdapter<
  TencentCampusConfig,
  TencentCampusDetail
> {
  return createTencentCampusVariant({
    key: 'tencent.campus',
    projectMappingIds: campusProjectMappingIds,
    category: 'campus',
  });
}
