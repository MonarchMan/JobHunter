import { parseNormalizedJob, utcInstant } from '@jobhunter/domain';
import { normalizeJobTaxonomy } from '../../../shared/normalization/job-taxonomy.js';
import { normalizeRecruitmentCategory } from '../../../shared/normalization/recruitment-category.js';
import {
  SourceError,
  canonicalizeOfficialUrl,
  type DiscoveryEvent,
  type JobSourceAdapter,
  type SourceHealth,
} from '@jobhunter/source-core';
import { ZodError } from 'zod';
import {
  baiduConfigSchema,
  baiduDiscoveredJobSchema,
  baiduListResponseSchema,
  type BaiduConfig,
  type BaiduDiscoveredJob,
  type BaiduListResponse,
  type BaiduRecruitType,
} from './schemas.js';

const hosts = ['talent.baidu.com'] as const;
const entryUrl = 'https://talent.baidu.com/jobs/list?recruitType=INTERN';
const listEndpoint = 'https://talent.baidu.com/httservice/getPostListNew';

/** 来源适配器使用的数据结构或契约。 */
interface BaiduAdapterVariant {
  readonly key: 'baidu.campus' | 'baidu.social';
  readonly entryUrl: string;
  readonly recruitmentType: 'campus' | 'social';
  readonly recruitTypes: readonly BaiduRecruitType[] | null;
}

/** 执行来源数据的解析、转换、请求或分页逻辑。 */
function parseSource<T>(parse: () => T, diagnostic: string): T {
  try {
    return parse();
  } catch (error) {
    if (error instanceof SourceError) throw error;
    throw new SourceError('parse_changed', diagnostic, { cause: error });
  }
}

/** 执行来源数据的解析、转换、请求或分页逻辑。 */
function requestHeaders(recruitType: BaiduRecruitType): Readonly<Record<string, string>> {
  return {
    'content-type': 'application/x-www-form-urlencoded;charset=utf-8',
    origin: 'https://talent.baidu.com',
    referer: `https://talent.baidu.com/jobs/list?recruitType=${recruitType}`,
  };
}

/** 执行来源数据的解析、转换、请求或分页逻辑。 */
function listBody(config: BaiduConfig, recruitType: BaiduRecruitType, page: number): string {
  return new URLSearchParams({
    recruitType,
    pageSize: String(config.pageSize),
    keyWord: config.keyword,
    curPage: String(page),
    projectType: '',
  }).toString();
}

/** 执行来源数据的解析、转换、请求或分页逻辑。 */
function jobUrl(recruitType: BaiduRecruitType, postId: string): string {
  return canonicalizeOfficialUrl(
    `https://talent.baidu.com/jobs/detail/${recruitType}/${encodeURIComponent(postId)}`,
    hosts,
  );
}

/** 执行来源数据的解析、转换、请求或分页逻辑。 */
function locations(value: string | null | undefined): string[] {
  return [
    ...new Set(
      (value ?? '')
        .split(/[，,、/]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

/** 执行来源数据的解析、转换、请求或分页逻辑。 */
function optionalText(...values: readonly (string | null | undefined)[]): string | null {
  for (const value of values) {
    if (value?.trim()) return value.trim();
  }
  return null;
}

/** 执行来源数据的解析、转换、请求或分页逻辑。 */
function description(job: BaiduDiscoveredJob): string {
  const value = [
    job.workContent?.trim() ? `岗位职责\n${job.workContent.trim()}` : null,
    job.serviceCondition?.trim() ? `任职要求\n${job.serviceCondition.trim()}` : null,
  ]
    .filter((item): item is string => item !== null)
    .join('\n\n');
  if (!value) throw new SourceError('parse_changed', 'Baidu job has no usable description.');
  return value;
}

/** 执行来源数据的解析、转换、请求或分页逻辑。 */
function publishedAt(job: BaiduDiscoveredJob): ReturnType<typeof utcInstant> | null {
  const value = optionalText(job.publishDate, job.updateDate);
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? utcInstant(timestamp) : null;
}

/** 执行来源数据的解析、转换、请求或分页逻辑。 */
function parseList(body: unknown): BaiduListResponse {
  return parseSource(
    () => baiduListResponseSchema.parse(body),
    'Baidu campus list response no longer matches the verified schema.',
  );
}

/** 执行来源数据的解析、转换、请求或分页逻辑。 */
function healthFailure(error: unknown, startedAt: number): SourceHealth {
  const sourceError =
    error instanceof SourceError
      ? error
      : new SourceError(
          'parse_changed',
          error instanceof ZodError
            ? 'Baidu campus list response schema changed.'
            : 'Baidu campus health check failed.',
          { cause: error },
        );
  return {
    status: sourceError.category === 'temporary' ? 'degraded' : 'unhealthy',
    checkedAt: Date.now(),
    latencyMs: Date.now() - startedAt,
    signals: [
      { key: 'anonymous_campus_list_schema', ok: false, diagnostic: sourceError.safeDiagnostic },
    ],
    errorCategory: sourceError.category,
  };
}

/** 执行来源数据的解析、转换、请求或分页逻辑。 */
function createBaiduVariant(variant: BaiduAdapterVariant): JobSourceAdapter<BaiduConfig, never> {
  return {
    metadata: {
      key: variant.key,
      version: '1.0.0',
      company: { slug: 'baidu', name: '百度' },
      recruitmentType: variant.recruitmentType,
      canonicalEntryUrl: variant.entryUrl,
      officialHosts: [...hosts],
      capabilities: { detail: 'inline', pagination: 'page', transport: 'json' },
      defaultRateLimit: { requestsPerMinute: 12, burst: 1 },
      externalIdFingerprintVersion: null,
    },
    configSchema: baiduConfigSchema,
    /** 执行来源适配器的该项操作。 */
    async *discover(context): AsyncIterable<DiscoveryEvent> {
      const seen = new Set<string>();
      let discoveredCount = 0;
      let emittedPages = 0;
      let coverage: 'complete' | 'partial' = 'complete';

      for (const recruitType of variant.recruitTypes ?? context.config.recruitTypes) {
        const seenForType = new Set<string>();
        let expectedCount: number | null = null;
        let expectedPages: number | null = null;

        for (let page = 1; expectedPages === null || page <= expectedPages; page += 1) {
          if (context.signal.aborted) {
            throw new SourceError('temporary', 'Baidu campus discovery was aborted.');
          }
          const response = await context.http.request({
            sourceKey: variant.key,
            requestId: context.requestId,
            url: listEndpoint,
            allowedHosts: hosts,
            signal: context.signal,
            method: 'POST',
            headers: requestHeaders(recruitType),
            body: listBody(context.config, recruitType, page),
            responseType: 'json',
            timeoutMs: context.timeoutMs,
          });
          const parsed = parseList(response.body);
          expectedCount ??= parsed.data.total;
          expectedPages ??=
            expectedCount === 0 ? 1 : Math.ceil(expectedCount / context.config.pageSize);
          if (
            parsed.data.total !== expectedCount ||
            parsed.data.pageNum !== page ||
            parsed.data.pageSize !== context.config.pageSize ||
            parsed.data.list.length > context.config.pageSize
          ) {
            coverage = 'partial';
          }

          for (const raw of parsed.data.list) {
            if (seenForType.has(raw.postId) || seen.has(raw.postId)) {
              coverage = 'partial';
              continue;
            }
            seenForType.add(raw.postId);
            seen.add(raw.postId);
            discoveredCount += 1;
            const discoveredRaw = { ...raw, recruitType };
            yield {
              type: 'job',
              job: {
                externalJobId: raw.postId,
                sourceUrl: jobUrl(recruitType, raw.postId),
                raw: discoveredRaw,
              },
            };
          }
          emittedPages += 1;
          yield { type: 'page', page: emittedPages, discoveredCount };

          if (page < expectedPages && parsed.data.list.length < context.config.pageSize) {
            coverage = 'partial';
            break;
          }
        }

        if (expectedCount === null || seenForType.size !== expectedCount) coverage = 'partial';
      }

      yield {
        type: 'complete',
        coverage,
        cursor: null,
        pages: emittedPages,
        discoveredCount,
      };
    },
    /** 执行来源适配器的该项操作。 */
    normalize(input, context) {
      return Promise.resolve().then(() => {
        const job = parseSource(
          () => baiduDiscoveredJobSchema.parse(input.discovered.raw),
          'Baidu discovered job no longer matches the verified schema.',
        );
        const officialUrl = jobUrl(job.recruitType, job.postId);
        const taxonomy = normalizeJobTaxonomy(job.postType);
        return {
          job: parseNormalizedJob({
            companyId: context.companyId,
            sourceId: context.sourceId,
            externalJobId: job.postId,
            title: job.name,
            department: optionalText(job.orgName, job.bgShortName),
            jobFamily: taxonomy.jobFamily,
            jobSubfamily: taxonomy.jobSubfamily,
            recruitmentCategory: normalizeRecruitmentCategory(
              job.recruitType === 'INTERN'
                ? '实习'
                : job.recruitType === 'SOCIAL'
                  ? '社招'
                  : '校招',
            ),
            locations: locations(job.workPlace),
            employmentType: job.recruitType === 'INTERN' ? '实习' : '全职',
            experienceText: optionalText(job.workYears),
            educationText: optionalText(job.education),
            description: description(job),
            detailUrl: officialUrl,
            applyUrl: officialUrl,
            publishedAt: publishedAt(job),
          }),
          provenance: {
            title: '$.name',
            department: '$.orgName|$.bgShortName',
            jobFamily: '$.postType',
            locations: '$.workPlace',
            employmentType: '$.recruitType',
            experienceText: '$.workYears',
            educationText: '$.education',
            description: '$.workContent+$.serviceCondition',
            publishedAt: '$.publishDate|$.updateDate',
          },
          sourcePrivateJson: {
            jobId: job.jobId,
            recruitNum: job.recruitNum ?? null,
            projectType: job.projectType ?? null,
            projectTypeCode: job.projectTypeCode ?? null,
          },
        };
      });
    },
    async healthCheck(context): Promise<SourceHealth> {
      const startedAt = Date.now();
      try {
        const recruitType = (variant.recruitTypes ?? context.config.recruitTypes)[0];
        if (!recruitType)
          throw new SourceError('invalid_config', 'No Baidu recruit type configured.');
        const response = await context.http.request({
          sourceKey: variant.key,
          requestId: context.requestId,
          url: listEndpoint,
          allowedHosts: hosts,
          signal: context.signal,
          method: 'POST',
          headers: requestHeaders(recruitType),
          body: listBody({ ...context.config, pageSize: 1 }, recruitType, 1),
          responseType: 'json',
          timeoutMs: context.timeoutMs,
        });
        const parsed = parseList(response.body);
        const ok = parsed.data.total > 0 && parsed.data.list.length > 0;
        return {
          status: ok ? 'healthy' : 'degraded',
          checkedAt: Date.now(),
          latencyMs: Date.now() - startedAt,
          signals: [
            {
              key: 'anonymous_campus_list_schema',
              ok,
              diagnostic: ok ? null : 'Baidu returned an empty campus list.',
            },
          ],
          errorCategory: null,
        };
      } catch (error) {
        return healthFailure(error, startedAt);
      }
    },
  };
}

/** 执行来源数据的解析、转换、请求或分页逻辑。 */
export function createBaiduAdapter(): JobSourceAdapter<BaiduConfig, never> {
  return createBaiduVariant({
    key: 'baidu.campus',
    entryUrl,
    recruitmentType: 'campus',
    recruitTypes: null,
  });
}

/** 执行来源数据的解析、转换、请求或分页逻辑。 */
export function createBaiduSocialAdapter(): JobSourceAdapter<BaiduConfig, never> {
  return createBaiduVariant({
    key: 'baidu.social',
    entryUrl: 'https://talent.baidu.com/jobs/list?recruitType=SOCIAL',
    recruitmentType: 'social',
    recruitTypes: ['SOCIAL'],
  });
}
