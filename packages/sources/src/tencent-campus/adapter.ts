import { parseNormalizedJob } from '@jobhunter/domain';
import {
  SourceError,
  canonicalizeOfficialUrl,
  type DiscoveryEvent,
  type JobSourceAdapter,
  type SourceHealth,
} from '@jobhunter/source-core';
import { normalizeJobTaxonomy } from '../job-taxonomy.js';
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

function headers(referer = entryUrl) {
  return { 'content-type': 'application/json', accept: 'application/json', referer };
}

function listBody(page: number, pageSize: number): string {
  return JSON.stringify({
    projectIdList: [],
    projectMappingIdList: internshipProjectMappingIds,
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

export function createTencentInternAdapter(): JobSourceAdapter<
  TencentCampusConfig,
  TencentCampusDetail
> {
  return {
    metadata: {
      key: 'tencent.intern',
      version: '1.0.0',
      company: { slug: 'tencent', name: '腾讯' },
      recruitmentType: 'campus',
      canonicalEntryUrl: entryUrl,
      officialHosts: [...hosts],
      capabilities: { detail: 'required', pagination: 'page', transport: 'json' },
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
      for (;;) {
        const response = await context.http.request({
          sourceKey: 'tencent.intern',
          requestId: context.requestId,
          url: listEndpoint,
          allowedHosts: hosts,
          signal: context.signal,
          method: 'POST',
          headers: headers(),
          body: listBody(page, context.config.pageSize),
          responseType: 'json',
          timeoutMs: context.timeoutMs,
        });
        const parsed = tencentCampusListResponseSchema.parse(response.body);
        count ??= parsed.data.count;
        if (count !== parsed.data.count) coverage = 'partial';
        for (const raw of parsed.data.positionList) {
          if (seen.has(raw.postId)) {
            coverage = 'partial';
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
      yield { type: 'complete', coverage, cursor: null, pages: page, discoveredCount };
    },
    async fetchDetail(job, context) {
      const url = new URL(detailEndpoint);
      url.searchParams.set('postId', job.externalJobId);
      const response = await context.http.request({
        sourceKey: 'tencent.intern',
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
      const detail = tencentCampusDetailSchema.parse(input.detail);
      if (list.postId !== detail.postId)
        throw new SourceError('parse_changed', 'Tencent campus list/detail identity differs.');
      const taxonomy = normalizeJobTaxonomy(detail.tidName);
      return Promise.resolve({
        job: parseNormalizedJob({
          companyId: context.companyId,
          sourceId: context.sourceId,
          externalJobId: detail.postId,
          title: detail.title,
          department: null,
          jobFamily: taxonomy.jobFamily,
          jobSubfamily: taxonomy.jobSubfamily,
          recruitmentCategory: 'internship',
          locations: detail.workCityList,
          employmentType: '实习',
          experienceText: null,
          educationText: null,
          description: [`岗位职责\n${detail.desc}`, `岗位要求\n${detail.request}`, detail.internBonus ? `实习加分项\n${detail.internBonus}` : null].filter(Boolean).join('\n\n'),
          detailUrl: jobUrl(detail.postId),
          applyUrl: jobUrl(detail.postId),
          publishedAt: null,
        }),
        provenance: { title: '$.data.title', locations: '$.data.workCityList', description: '$.data.desc+$.data.request' },
        sourcePrivateJson: { projectName: detail.projectName, recruitLabelName: detail.recruitLabelName },
      });
    },
    async healthCheck(context): Promise<SourceHealth> {
      const startedAt = Date.now();
      try {
        const response = await context.http.request({
          sourceKey: 'tencent.intern', requestId: context.requestId, url: listEndpoint,
          allowedHosts: hosts, signal: context.signal, method: 'POST', headers: headers(),
          body: listBody(1, 1), responseType: 'json', timeoutMs: context.timeoutMs,
        });
        const parsed = tencentCampusListResponseSchema.parse(response.body);
        const ok = parsed.data.count > 0 && parsed.data.positionList.length > 0;
        return { status: ok ? 'healthy' : 'degraded', checkedAt: Date.now(), latencyMs: Date.now() - startedAt, signals: [{ key: 'anonymous_intern_list', ok, diagnostic: ok ? null : 'Tencent returned no internship jobs.' }], errorCategory: null };
      } catch (error) {
        const sourceError = error instanceof SourceError ? error : new SourceError('parse_changed', 'Tencent internship health check failed.', { cause: error });
        return { status: 'unhealthy', checkedAt: Date.now(), latencyMs: Date.now() - startedAt, signals: [{ key: 'anonymous_intern_list', ok: false, diagnostic: sourceError.safeDiagnostic }], errorCategory: sourceError.category };
      }
    },
  };
}
