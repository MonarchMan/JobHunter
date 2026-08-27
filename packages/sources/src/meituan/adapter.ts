import { parseNormalizedJob, utcInstant } from '@jobhunter/domain';
import { normalizeJobTaxonomy } from '../job-taxonomy.js';
import { normalizeRecruitmentCategory } from '../recruitment-category.js';
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

function listBody(config: MeituanConfig, page: number, jobTypeCodes: readonly string[]): string {
  return JSON.stringify({
    page: { pageNo: page, pageSize: config.pageSize },
    jobShareType: config.jobShareType,
    keywords: config.keywords,
    cityList: [],
    department: [],
    jfJgList: [],
    jobType: jobTypeCodes.map((code) => ({ code, subCode: [] })),
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

function createMeituanChannelAdapter(options: {
  readonly key: 'meituan.social' | 'meituan.intern';
  readonly entryUrl: string;
  readonly jobTypeCodes: readonly string[];
  readonly category: 'social' | 'internship';
}): JobSourceAdapter<MeituanConfig, MeituanDetail> {
  return {
    metadata: {
      key: options.key,
      version: '1.0.0',
      company: { slug: 'meituan', name: '美团' },
      recruitmentType: options.category === 'social' ? 'social' : 'campus',
      canonicalEntryUrl: options.entryUrl,
      officialHosts: [...hosts],
      capabilities: {
        detail: options.category === 'internship' ? 'inline' : 'deferred',
        pagination: 'page',
        transport: options.category === 'internship' ? 'browser' : 'json',
      },
      defaultRateLimit: { requestsPerMinute: 12, burst: 1 },
      externalIdFingerprintVersion: null,
    },
    configSchema: meituanConfigSchema,
    async *discover(context): AsyncIterable<DiscoveryEvent> {
      if (options.category === 'internship') {
        if (!context.page?.collect) {
          throw new SourceError(
            'access_blocked',
            'Meituan internship source requires an anonymous browser collection session.',
          );
        }
        const collection = await context.page.collect({
          sourceKey: options.key,
          requestId: context.requestId,
          url: options.entryUrl,
          allowedHosts: hosts,
          listEndpointPath: '/api/official/job/getJobList',
          responseShape: 'meituan-jobs',
          maximumPages: 1_000,
          signal: context.signal,
          timeoutMs: context.timeoutMs,
          operationTimeoutMs: 180_000,
          maximumResponseBytes: 2 * 1024 * 1024,
        });
        let discoveredCount = 0;
        const seen = new Set<string>();
        let coverage = collection.coverage;
        for (const collectedPage of collection.pages) {
          for (const value of collectedPage.records) {
            const raw = meituanJobSchema.parse(value);
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
          yield { type: 'page', page: collectedPage.page, discoveredCount };
        }
        yield {
          type: 'complete',
          coverage,
          cursor: null,
          pages: collection.pages.length,
          discoveredCount,
          diagnostics: {
            ...collection.diagnostics,
            reason: collection.diagnostics?.reason ?? null,
            retryable: collection.diagnostics?.retryable ?? false,
            discoveredCount,
            duplicateIds:
              collection.diagnostics?.duplicateIds ??
              collection.pages.reduce((count, page) => count + page.records.length, 0) - seen.size,
          },
        };
        return;
      }
      let page = 1;
      let discoveredCount = 0;
      let expectedCount: number | null = null;
      let expectedPages: number | null = null;
      const seen = new Set<string>();
      let coverage: 'complete' | 'partial' = 'complete';
      let duplicateIds = 0;
      let totalChanged = false;

      for (;;) {
        if (context.signal.aborted) {
          throw new SourceError('temporary', 'Meituan discovery was aborted.');
        }
        const response = await context.http.request({
          sourceKey: options.key,
          requestId: context.requestId,
          url: listEndpoint,
          allowedHosts: hosts,
          signal: context.signal,
          method: 'POST',
          headers: requestHeaders(options.entryUrl),
          body: listBody(context.config, page, options.jobTypeCodes),
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
          totalChanged = true;
        }

        for (const raw of parsed.data.list) {
          if (seen.has(raw.jobUnionId)) {
            coverage = 'partial';
            duplicateIds += 1;
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
          expectedCount,
          discoveredCount,
          expectedPages,
          fetchedPages: page,
          duplicateIds,
          totalChanged,
        },
      };
    },
    ...(options.category === 'social'
      ? {
          async fetchDetail(job, context): Promise<MeituanDetail> {
            const response = await context.http.request({
              sourceKey: options.key,
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
        }
      : {}),
    normalize(input, context) {
      return Promise.resolve().then(() => {
        const list = parseSource(
          () => meituanJobSchema.parse(input.discovered.raw),
          'Meituan discovered job no longer matches the verified schema.',
        );
        const detail = parseSource(
          () =>
            meituanJobSchema.parse(
              options.category === 'internship' || input.detail === null
                ? input.discovered.raw
                : input.detail,
            ),
          input.detail === null
            ? 'Meituan list record changed.'
            : 'Meituan detail response changed.',
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
        const description = descriptions(detail) || `职位名称\n${detail.name}`;
        const taxonomy = normalizeJobTaxonomy(
          optionalText(detail.jobFamily, detail.jobFamilyGroup),
        );
        return {
          job: parseNormalizedJob({
            companyId: context.companyId,
            sourceId: context.sourceId,
            externalJobId: detail.jobUnionId,
            title: detail.name,
            department: optionalText(detail.department[0]?.name),
            jobFamily: taxonomy.jobFamily,
            jobSubfamily: taxonomy.jobSubfamily,
            recruitmentCategory:
              options.category === 'internship'
                ? 'internship'
                : normalizeRecruitmentCategory(detail.name) === 'internship'
                  ? 'internship'
                  : 'social',
            locations: detail.cityList.map((city) => city.name),
            employmentType: options.category === 'internship' ? '实习' : '全职',
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
        if (options.category === 'internship') {
          if (!context.page?.collect) {
            throw new SourceError(
              'access_blocked',
              'Meituan internship source requires an anonymous browser collection session.',
            );
          }
          const collection = await context.page.collect({
            sourceKey: options.key,
            requestId: context.requestId,
            url: options.entryUrl,
            allowedHosts: hosts,
            listEndpointPath: '/api/official/job/getJobList',
            responseShape: 'meituan-jobs',
            maximumPages: 1,
            signal: context.signal,
            timeoutMs: context.timeoutMs,
            maximumResponseBytes: 2 * 1024 * 1024,
          });
          const count = collection.pages.reduce((sum, page) => sum + page.records.length, 0);
          return {
            status: count > 0 ? 'healthy' : 'degraded',
            checkedAt: Date.now(),
            latencyMs: Date.now() - startedAt,
            signals: [
              {
                key: 'browser_json_intern_list',
                ok: count > 0,
                diagnostic: count > 0 ? null : 'Meituan returned no internship jobs.',
              },
            ],
            errorCategory: null,
          };
        }
        const response = await context.http.request({
          sourceKey: options.key,
          requestId: context.requestId,
          url: listEndpoint,
          allowedHosts: hosts,
          signal: context.signal,
          method: 'POST',
          headers: requestHeaders(options.entryUrl),
          body: listBody({ ...context.config, pageSize: 1 }, 1, options.jobTypeCodes),
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

export function createMeituanAdapter(): JobSourceAdapter<MeituanConfig, MeituanDetail> {
  return createMeituanChannelAdapter({
    key: 'meituan.social',
    entryUrl,
    jobTypeCodes: ['3'],
    category: 'social',
  });
}

export function createMeituanInternAdapter(): JobSourceAdapter<MeituanConfig, MeituanDetail> {
  return createMeituanChannelAdapter({
    key: 'meituan.intern',
    entryUrl: 'https://zhaopin.meituan.com/web/campus',
    jobTypeCodes: ['2'],
    category: 'internship',
  });
}
