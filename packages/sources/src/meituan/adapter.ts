import { parseNormalizedJob, utcInstant } from '@jobhunter/domain';
import {
  SourceError,
  canonicalizeOfficialUrl,
  type DiscoveryEvent,
  type JobSourceAdapter,
  type SourceHealth,
} from '@jobhunter/source-core';
import { ZodError } from 'zod';
import {
  meituanConfigSchema,
  meituanDetailResponseSchema,
  meituanJobSchema,
  meituanListResponseSchema,
  type MeituanConfig,
  type MeituanDetail,
} from './schemas.js';

const hosts = ['zhaopin.meituan.com'] as const;
const entryUrl = 'https://zhaopin.meituan.com/web/social';
const listEndpoint = 'https://zhaopin.meituan.com/api/official/job/getJobList';
const detailEndpoint = 'https://zhaopin.meituan.com/api/official/job/getJobDetail';

function parseSource<T>(parse: () => T, diagnostic: string): T {
  try {
    return parse();
  } catch (error) {
    if (error instanceof SourceError) throw error;
    throw new SourceError('parse_changed', diagnostic, { cause: error });
  }
}

function requestHeaders(referer: string): Readonly<Record<string, string>> {
  return {
    'content-type': 'application/json',
    origin: 'https://zhaopin.meituan.com',
    referer,
  };
}

function listBody(config: MeituanConfig, page: number): string {
  return JSON.stringify({
    page: { pageNo: page, pageSize: config.pageSize },
    jobShareType: config.jobShareType,
    keywords: config.keywords,
    cityList: [],
    department: [],
    jfJgList: [],
    jobType: [{ code: '3', subCode: [] }],
    typeCode: [],
    specialCode: [],
    u_query_id: null,
    r_query_id: null,
  });
}

function detailBody(externalJobId: string, config: MeituanConfig): string {
  return JSON.stringify({ jobUnionId: externalJobId, jobShareType: config.jobShareType });
}

function canonicalJobUrl(
  pathname: '/web/position/detail' | '/web/delivery-confirm',
  id: string,
): string {
  const url = new URL(`https://zhaopin.meituan.com${pathname}`);
  url.searchParams.set('jobUnionId', id);
  url.searchParams.set('jobShareType', '1');
  return canonicalizeOfficialUrl(url.toString(), hosts);
}

function optionalText(...values: readonly (string | null | undefined)[]): string | null {
  for (const value of values) {
    if (value?.trim()) return value;
  }
  return null;
}

function publishedAt(detail: MeituanDetail): ReturnType<typeof utcInstant> | null {
  const value = detail.firstPostTime ?? detail.refreshTime;
  return value === null || value === undefined ? null : utcInstant(value);
}

function descriptions(detail: MeituanDetail): string {
  return [
    detail.desc ? `岗位简介\n${detail.desc}` : null,
    detail.departmentIntro ? `部门介绍\n${detail.departmentIntro}` : null,
    detail.jobDuty ? `岗位职责\n${detail.jobDuty}` : null,
    detail.jobRequirement ? `任职要求\n${detail.jobRequirement}` : null,
    detail.precedence ? `优先条件\n${detail.precedence}` : null,
    detail.highLight ? `岗位亮点\n${detail.highLight}` : null,
  ]
    .filter((value): value is string => value !== null)
    .join('\n\n');
}

export function createMeituanAdapter(): JobSourceAdapter<MeituanConfig, MeituanDetail> {
  return {
    metadata: {
      key: 'meituan.social',
      version: '1.0.0',
      company: { slug: 'meituan', name: '美团' },
      recruitmentType: 'social',
      canonicalEntryUrl: entryUrl,
      officialHosts: [...hosts],
      capabilities: { detail: 'required', pagination: 'page', transport: 'json' },
      defaultRateLimit: { requestsPerMinute: 12, burst: 1 },
      externalIdFingerprintVersion: null,
    },
    configSchema: meituanConfigSchema,
    async *discover(context): AsyncIterable<DiscoveryEvent> {
      let page = 1;
      let discoveredCount = 0;
      let expectedCount: number | null = null;
      let expectedPages: number | null = null;
      const seen = new Set<string>();
      let coverage: 'complete' | 'partial' = 'complete';

      for (;;) {
        if (context.signal.aborted) {
          throw new SourceError('temporary', 'Meituan discovery was aborted.');
        }
        const response = await context.http.request({
          sourceKey: 'meituan.social',
          requestId: context.requestId,
          url: listEndpoint,
          allowedHosts: hosts,
          signal: context.signal,
          method: 'POST',
          headers: requestHeaders(entryUrl),
          body: listBody(context.config, page),
          responseType: 'json',
          timeoutMs: context.timeoutMs,
        });
        const parsed = parseSource(
          () => meituanListResponseSchema.parse(response.body),
          'Meituan list response no longer matches the verified schema.',
        );
        const pageInfo = parsed.data.page;
        expectedCount ??= pageInfo.totalCount;
        expectedPages ??= pageInfo.totalPage;
        if (
          expectedCount !== pageInfo.totalCount ||
          expectedPages !== pageInfo.totalPage ||
          pageInfo.pageNo !== page
        ) {
          coverage = 'partial';
        }

        for (const raw of parsed.data.list) {
          if (seen.has(raw.jobUnionId)) {
            coverage = 'partial';
            continue;
          }
          seen.add(raw.jobUnionId);
          discoveredCount += 1;
          yield {
            type: 'job',
            job: {
              externalJobId: raw.jobUnionId,
              sourceUrl: canonicalJobUrl('/web/position/detail', raw.jobUnionId),
              raw,
            },
          };
        }
        yield { type: 'page', page, discoveredCount };

        if (page >= expectedPages || discoveredCount >= expectedCount) break;
        if (parsed.data.list.length === 0) {
          coverage = 'partial';
          break;
        }
        if (parsed.data.list.length < pageInfo.pageSize) coverage = 'partial';
        page += 1;
      }

      if (discoveredCount !== expectedCount || page !== expectedPages) coverage = 'partial';
      yield {
        type: 'complete',
        coverage,
        cursor: null,
        pages: page,
        discoveredCount,
      };
    },
    async fetchDetail(job, context): Promise<MeituanDetail> {
      const response = await context.http.request({
        sourceKey: 'meituan.social',
        requestId: context.requestId,
        url: detailEndpoint,
        allowedHosts: hosts,
        signal: context.signal,
        method: 'POST',
        headers: requestHeaders(job.sourceUrl),
        body: detailBody(job.externalJobId, context.config),
        responseType: 'json',
        timeoutMs: context.timeoutMs,
      });
      const parsed = parseSource(
        () => meituanDetailResponseSchema.parse(response.body),
        'Meituan detail response no longer matches the verified schema.',
      );
      if (parsed.data.jobUnionId !== job.externalJobId) {
        throw new SourceError(
          'parse_changed',
          'Meituan detail returned a different stable job ID.',
        );
      }
      return parsed.data;
    },
    normalize(input, context) {
      return Promise.resolve().then(() => {
        const list = parseSource(
          () => meituanJobSchema.parse(input.discovered.raw),
          'Meituan discovered job no longer matches the verified schema.',
        );
        const detail = parseSource(
          () => meituanJobSchema.parse(input.detail),
          'Meituan detail is required for normalization.',
        );
        if (
          list.jobUnionId !== detail.jobUnionId ||
          detail.jobUnionId !== input.discovered.externalJobId
        ) {
          throw new SourceError(
            'parse_changed',
            'Meituan list/detail job identity does not match.',
          );
        }
        const description = descriptions(detail);
        if (!description) {
          throw new SourceError('parse_changed', 'Meituan detail contains no usable description.');
        }
        return {
          job: parseNormalizedJob({
            companyId: context.companyId,
            sourceId: context.sourceId,
            externalJobId: detail.jobUnionId,
            title: detail.name,
            department: optionalText(detail.department[0]?.name),
            jobFamily: optionalText(detail.jobFamily, detail.jobFamilyGroup),
            locations: detail.cityList.map((city) => city.name),
            employmentType: detail.jobType === '3' ? '全职' : null,
            experienceText: optionalText(detail.workYear),
            educationText: null,
            description,
            detailUrl: canonicalJobUrl('/web/position/detail', detail.jobUnionId),
            applyUrl: canonicalJobUrl('/web/delivery-confirm', detail.jobUnionId),
            publishedAt: publishedAt(detail),
          }),
          provenance: {
            title: '$.data.name',
            department: '$.data.department[0].name',
            jobFamily: '$.data.jobFamily|$.data.jobFamilyGroup',
            locations: '$.data.cityList[].name',
            description:
              '$.data.desc+$.data.departmentIntro+$.data.jobDuty+$.data.jobRequirement+$.data.precedence+$.data.highLight',
            publishedAt: '$.data.firstPostTime|$.data.refreshTime',
          },
          sourcePrivateJson: {
            jobStatus: detail.jobStatus,
            jobSource: detail.jobSource ?? null,
            jobSpecialCode: detail.jobSpecialCode ?? null,
            expiredTime: detail.expiredTime ?? null,
          },
        };
      });
    },
    async healthCheck(context): Promise<SourceHealth> {
      const startedAt = Date.now();
      try {
        const response = await context.http.request({
          sourceKey: 'meituan.social',
          requestId: context.requestId,
          url: listEndpoint,
          allowedHosts: hosts,
          signal: context.signal,
          method: 'POST',
          headers: requestHeaders(entryUrl),
          body: listBody({ ...context.config, pageSize: 1 }, 1),
          responseType: 'json',
          timeoutMs: context.timeoutMs,
        });
        const parsed = meituanListResponseSchema.parse(response.body);
        const hasJobs = parsed.data.page.totalCount > 0 && parsed.data.list.length > 0;
        return {
          status: hasJobs ? 'healthy' : 'degraded',
          checkedAt: Date.now(),
          latencyMs: Date.now() - startedAt,
          signals: [
            {
              key: 'anonymous_list_schema',
              ok: hasJobs,
              diagnostic: hasJobs ? null : 'Meituan returned an empty public list.',
            },
          ],
          errorCategory: null,
        };
      } catch (error) {
        const sourceError =
          error instanceof SourceError
            ? error
            : new SourceError(
                'parse_changed',
                error instanceof ZodError
                  ? 'Meituan health response schema changed.'
                  : 'Meituan health check failed.',
                { cause: error },
              );
        return {
          status: sourceError.category === 'temporary' ? 'degraded' : 'unhealthy',
          checkedAt: Date.now(),
          latencyMs: Date.now() - startedAt,
          signals: [
            { key: 'anonymous_list_schema', ok: false, diagnostic: sourceError.safeDiagnostic },
          ],
          errorCategory: sourceError.category,
        };
      }
    },
  };
}
