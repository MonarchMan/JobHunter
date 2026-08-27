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
  tencentConfigSchema,
  tencentDetailResponseSchema,
  tencentDetailSchema,
  tencentListJobSchema,
  tencentListResponseSchema,
  type TencentConfig,
  type TencentDetail,
} from './schemas.js';

const hosts = ['careers.tencent.com'] as const;
const entryUrl = 'https://careers.tencent.com/search.html';
const listEndpoint = 'https://careers.tencent.com/tencentcareer/api/post/Query';
const detailEndpoint = 'https://careers.tencent.com/tencentcareer/api/post/ByPostId';

function parseSource<T>(parse: () => T, diagnostic: string): T {
  try {
    return parse();
  } catch (error) {
    if (error instanceof SourceError) throw error;
    throw new SourceError('parse_changed', diagnostic, { cause: error });
  }
}

function listUrl(config: TencentConfig, page: number): string {
  const url = new URL(listEndpoint);
  for (const [key, value] of Object.entries({
    countryId: '',
    cityId: '',
    bgIds: '',
    productId: '',
    categoryId: '',
    parentCategoryId: '',
    attrId: '',
    keyword: '',
    pageIndex: String(page),
    pageSize: String(config.pageSize),
    language: config.language,
    area: 'cn',
  })) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function detailUrl(externalJobId: string, language: TencentConfig['language']): string {
  const url = new URL(detailEndpoint);
  url.searchParams.set('postId', externalJobId);
  url.searchParams.set('language', language);
  return url.toString();
}

function canonicalDetailUrl(externalJobId: string): string {
  return canonicalizeOfficialUrl(
    `https://careers.tencent.com/jobdesc.html?postId=${encodeURIComponent(externalJobId)}`,
    hosts,
  );
}

function publishedAt(value: string | null | undefined): ReturnType<typeof utcInstant> | null {
  if (!value) return null;
  const match = /^(\d{4})年(\d{2})月(\d{2})日$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const milliseconds = Date.UTC(year, month - 1, day);
  return Number.isSafeInteger(milliseconds) && milliseconds >= 0 ? utcInstant(milliseconds) : null;
}

function applyUrl(detail: Pick<TencentDetail, 'PostId' | 'RecruitPostName'>): string {
  const url = new URL('https://careers.tencent.com/resume.html');
  url.searchParams.set('operType', '3');
  url.searchParams.set('postId', detail.PostId);
  url.searchParams.set('postName', detail.RecruitPostName);
  return canonicalizeOfficialUrl(url.toString(), hosts);
}

function optionalText(...values: readonly (string | null | undefined)[]): string | null {
  for (const value of values) {
    if (value?.trim()) return value;
  }
  return null;
}

export function createTencentAdapter(): JobSourceAdapter<TencentConfig, TencentDetail> {
  return {
    metadata: {
      key: 'tencent.social',
      version: '1.0.0',
      company: { slug: 'tencent', name: '腾讯' },
      recruitmentType: 'social',
      canonicalEntryUrl: entryUrl,
      officialHosts: [...hosts],
      capabilities: { detail: 'deferred', pagination: 'page', transport: 'json' },
      defaultRateLimit: { requestsPerMinute: 12, burst: 1 },
      externalIdFingerprintVersion: null,
    },
    configSchema: tencentConfigSchema,
    async *discover(context): AsyncIterable<DiscoveryEvent> {
      let page = 1;
      let discoveredCount = 0;
      let expectedCount: number | null = null;
      const seen = new Set<string>();
      let coverage: 'complete' | 'partial' = 'complete';
      let duplicateIds = 0;
      let totalChanged = false;

      for (;;) {
        if (context.signal.aborted) {
          throw new SourceError('temporary', 'Tencent discovery was aborted.');
        }
        const response = await context.http.request({
          sourceKey: 'tencent.social',
          requestId: context.requestId,
          url: listUrl(context.config, page),
          allowedHosts: hosts,
          signal: context.signal,
          responseType: 'json',
          timeoutMs: context.timeoutMs,
          headers: { referer: entryUrl },
        });
        const parsed = parseSource(
          () => tencentListResponseSchema.parse(response.body),
          'Tencent list response no longer matches the verified schema.',
        );
        expectedCount ??= parsed.Data.Count;
        if (expectedCount !== parsed.Data.Count) {
          coverage = 'partial';
          totalChanged = true;
        }

        for (const raw of parsed.Data.Posts) {
          if (seen.has(raw.PostId)) {
            coverage = 'partial';
            duplicateIds += 1;
            continue;
          }
          seen.add(raw.PostId);
          discoveredCount += 1;
          yield {
            type: 'job',
            job: {
              externalJobId: raw.PostId,
              sourceUrl: canonicalDetailUrl(raw.PostId),
              raw,
            },
          };
        }
        yield { type: 'page', page, discoveredCount };

        if (parsed.Data.Posts.length === 0 || discoveredCount >= expectedCount) break;
        if (parsed.Data.Posts.length < context.config.pageSize) {
          coverage = 'partial';
          break;
        }
        page += 1;
      }

      if (discoveredCount !== expectedCount) coverage = 'partial';
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
          expectedPages: Math.ceil(expectedCount / context.config.pageSize),
          fetchedPages: page,
          duplicateIds,
          totalChanged,
        },
      };
    },
    async fetchDetail(job, context): Promise<TencentDetail> {
      const response = await context.http.request({
        sourceKey: 'tencent.social',
        requestId: context.requestId,
        url: detailUrl(job.externalJobId, context.config.language),
        allowedHosts: hosts,
        signal: context.signal,
        responseType: 'json',
        timeoutMs: context.timeoutMs,
        headers: { referer: job.sourceUrl },
      });
      const parsed = parseSource(
        () => tencentDetailResponseSchema.parse(response.body),
        'Tencent detail response no longer matches the verified schema.',
      );
      if (parsed.Data.PostId !== job.externalJobId) {
        throw new SourceError(
          'parse_changed',
          'Tencent detail returned a different stable job ID.',
        );
      }
      return parsed.Data;
    },
    normalize(input, context) {
      return Promise.resolve().then(() => {
        const list = parseSource(
          () => tencentListJobSchema.parse(input.discovered.raw),
          'Tencent discovered job no longer matches the verified schema.',
        );
        const detail = input.detail
          ? parseSource(
              () => tencentDetailSchema.parse(input.detail),
              'Tencent detail response changed.',
            )
          : null;
        if (
          list.PostId !== input.discovered.externalJobId ||
          (detail !== null && detail.PostId !== input.discovered.externalJobId)
        ) {
          throw new SourceError(
            'parse_changed',
            'Tencent list/detail job identity does not match.',
          );
        }
        const description = [
          `岗位职责\n${list.Responsibility}`,
          detail ? `岗位要求\n${detail.Requirement}` : null,
          detail?.DepartmentIntroduction ? `部门介绍\n${detail.DepartmentIntroduction}` : null,
        ]
          .filter((value): value is string => value !== null)
          .join('\n\n');
        const taxonomy = normalizeJobTaxonomy(optionalText(list.CategoryName));
        const recruitmentCategory =
          normalizeRecruitmentCategory(list.RecruitPostName) === 'internship'
            ? 'internship'
            : 'social';
        return {
          job: parseNormalizedJob({
            companyId: context.companyId,
            sourceId: context.sourceId,
            externalJobId: list.PostId,
            title: list.RecruitPostName,
            department: optionalText(list.ComName, list.BGName),
            jobFamily: taxonomy.jobFamily,
            jobSubfamily: taxonomy.jobSubfamily,
            recruitmentCategory,
            locations: list.LocationName ? [list.LocationName] : [],
            employmentType: recruitmentCategory === 'internship' ? '实习' : '全职',
            experienceText: optionalText(list.RequireWorkYearsName),
            educationText: null,
            description,
            detailUrl: canonicalDetailUrl(list.PostId),
            applyUrl: applyUrl(list),
            publishedAt: publishedAt(list.LastUpdateTime),
          }),
          provenance: {
            title: '$.Data.RecruitPostName',
            department: '$.Data.ComName|$.Data.BGName',
            jobFamily: '$.Data.CategoryName',
            locations: '$.Data.LocationName',
            description: '$.Data.Responsibility+$.Data.Requirement',
            publishedAt: '$.Data.LastUpdateTime',
          },
          sourcePrivateJson: {
            bgCode: list.ComCode ?? null,
            productName: list.ProductName ?? null,
            sourceType: list.SourceID,
          },
        };
      });
    },
    async healthCheck(context): Promise<SourceHealth> {
      const startedAt = Date.now();
      try {
        const response = await context.http.request({
          sourceKey: 'tencent.social',
          requestId: context.requestId,
          url: listUrl({ ...context.config, pageSize: 1 }, 1),
          allowedHosts: hosts,
          signal: context.signal,
          responseType: 'json',
          timeoutMs: context.timeoutMs,
          headers: { referer: entryUrl },
        });
        const parsed = tencentListResponseSchema.parse(response.body);
        return {
          status: parsed.Data.Count > 0 && parsed.Data.Posts.length > 0 ? 'healthy' : 'degraded',
          checkedAt: Date.now(),
          latencyMs: Date.now() - startedAt,
          signals: [
            {
              key: 'anonymous_list_schema',
              ok: parsed.Data.Count > 0 && parsed.Data.Posts.length > 0,
              diagnostic: parsed.Data.Count > 0 ? null : 'Tencent returned an empty public list.',
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
                  ? 'Tencent health response schema changed.'
                  : 'Tencent health check failed.',
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
