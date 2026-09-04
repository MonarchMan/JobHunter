import { parseNormalizedJob, utcInstant } from '@jobhunter/domain';
import { normalizeJobTaxonomy } from '../../../shared/normalization/job-taxonomy.js';
import {
  SourceError,
  canonicalizeOfficialUrl,
  type DiscoveryEvent,
  type JobSourceAdapter,
  type SourceHealth,
} from '@jobhunter/source-core';
import { ZodError } from 'zod';
import {
  jdCampusConfigSchema,
  jdCampusJobSchema,
  jdCampusListResponseSchema,
  type JdCampusConfig,
  type JdCampusJob,
} from './schemas.js';

const hosts = ['campus.jd.com'] as const;
const entryUrl = 'https://campus.jd.com/home';
const listEndpoint = 'https://campus.jd.com/api/wx/position/page?type=present';

/** 来源适配器使用的数据结构或契约。 */
function parseSource<T>(parse: () => T, diagnostic: string): T {
  try {
    return parse();
  } catch (error) {
    if (error instanceof SourceError) throw error;
    throw new SourceError('parse_changed', diagnostic, { cause: error });
  }
}

/** 执行来源数据的解析、转换、请求或分页逻辑。 */
function requestHeaders(): Readonly<Record<string, string>> {
  return {
    'content-type': 'application/json',
    origin: 'https://campus.jd.com',
    referer: entryUrl,
    'x-requested-with': 'XMLHttpRequest',
  };
}

/** 执行来源数据的解析、转换、请求或分页逻辑。 */
function listBody(config: JdCampusConfig, pageIndex: number): string {
  return JSON.stringify({
    pageSize: config.pageSize,
    pageIndex,
    parameter: {
      positionName: config.keyword,
      planIdList: config.planIdList,
      jobDirectionCodeList: [],
      workCityCodeList: [],
      positionDeptList: [],
    },
  });
}

/** 执行来源数据的解析、转换、请求或分页逻辑。 */
function canonicalJobUrl(publishId: string | number): string {
  return canonicalizeOfficialUrl(
    `https://campus.jd.com/#/details?id=${encodeURIComponent(String(publishId))}&type=present`,
    hosts,
  );
}

/** 执行来源数据的解析、转换、请求或分页逻辑。 */
function title(job: JdCampusJob): string {
  const value = job.positionName ?? job.positionNameOpen;
  if (!value?.trim()) throw new SourceError('parse_changed', 'JD campus job has no title.');
  return value;
}

/** 执行来源数据的解析、转换、请求或分页逻辑。 */
function locations(job: JdCampusJob): string[] {
  return [job.workCity, ...(job.requirementVoList ?? []).map((item) => item.workCity)]
    .flatMap((value) => (value ?? '').split(/[，,、/]/))
    .map((value) => value.trim())
    .filter((value) => value.length > 0 && value !== '/')
    .toSorted((left, right) => left.localeCompare(right, 'zh-CN'));
}

/** 执行来源数据的解析、转换、请求或分页逻辑。 */
function description(job: JdCampusJob): string {
  const text = [
    job.workContent ? `岗位职责\n${job.workContent}` : null,
    job.qualification ? `任职要求\n${job.qualification}` : null,
  ]
    .filter((value): value is string => value !== null)
    .join('\n\n');
  if (!text) throw new SourceError('parse_changed', 'JD campus job has no usable description.');
  return text;
}

/** 执行来源数据的解析、转换、请求或分页逻辑。 */
function healthFailure(error: unknown, startedAt: number): SourceHealth {
  const sourceError =
    error instanceof SourceError
      ? error
      : new SourceError(
          'parse_changed',
          error instanceof ZodError
            ? 'JD campus list response schema changed.'
            : 'JD campus health check failed.',
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
interface JdChannelOptions {
  readonly key: 'jd.campus' | 'jd.intern';
  readonly category: 'campus' | 'internship';
  readonly employmentType: '校招' | '实习';
}

function createJdChannelAdapter(
  options: JdChannelOptions,
): JobSourceAdapter<JdCampusConfig, never> {
  return {
    metadata: {
      key: options.key,
      version: '1.0.0',
      company: { slug: 'jd', name: '京东' },
      recruitmentType: 'campus',
      canonicalEntryUrl: entryUrl,
      officialHosts: [...hosts],
      capabilities: { detail: 'inline', pagination: 'page', transport: 'json' },
      defaultRateLimit: { requestsPerMinute: 6, burst: 1 },
      externalIdFingerprintVersion: null,
    },
    configSchema: jdCampusConfigSchema,
    /** 执行来源适配器的该项操作。 */
    async *discover(context): AsyncIterable<DiscoveryEvent> {
      const expectedPages = (total: number): number =>
        total === 0 ? 0 : Math.ceil(total / context.config.pageSize);
      let expectedCount = 0;
      let discoveredCount = 0;
      let coverage: 'complete' | 'partial' = 'complete';
      const seen = new Set<string>();
      let pageIndex = 0;

      for (;;) {
        if (context.signal.aborted) {
          throw new SourceError('temporary', 'JD campus discovery was aborted.');
        }
        const response = await context.http.request({
          sourceKey: options.key,
          requestId: context.requestId,
          url: listEndpoint,
          allowedHosts: hosts,
          signal: context.signal,
          method: 'POST',
          headers: requestHeaders(),
          body: listBody(context.config, pageIndex),
          responseType: 'json',
          timeoutMs: context.timeoutMs,
        });
        const parsed = parseSource(
          () => jdCampusListResponseSchema.parse(response.body),
          'JD campus list response no longer matches the verified schema.',
        );
        if (pageIndex === 0) expectedCount = parsed.body.totalNumber;
        if (expectedCount !== parsed.body.totalNumber) coverage = 'partial';
        if (parsed.body.items.length > context.config.pageSize) coverage = 'partial';

        for (const raw of parsed.body.items) {
          const externalJobId = String(raw.publishId);
          if (seen.has(externalJobId)) {
            coverage = 'partial';
            continue;
          }
          seen.add(externalJobId);
          discoveredCount += 1;
          yield {
            type: 'job',
            job: { externalJobId, sourceUrl: canonicalJobUrl(raw.publishId), raw },
          };
        }
        yield { type: 'page', page: pageIndex + 1, discoveredCount };

        const pages = expectedPages(expectedCount);
        if (discoveredCount >= expectedCount || parsed.body.items.length === 0) break;
        if (parsed.body.items.length < context.config.pageSize || pageIndex + 1 >= pages) {
          coverage = 'partial';
          break;
        }
        pageIndex += 1;
      }

      if (discoveredCount !== expectedCount) coverage = 'partial';
      yield {
        type: 'complete',
        coverage,
        cursor: null,
        pages: pageIndex + 1,
        discoveredCount,
      };
    },
    /** 执行来源适配器的该项操作。 */
    normalize(input, context) {
      return Promise.resolve().then(() => {
        const job = parseSource(
          () => jdCampusJobSchema.parse(input.discovered.raw),
          'JD campus discovered job no longer matches the verified schema.',
        );
        const taxonomy = normalizeJobTaxonomy(job.jobDirection ?? job.jobCategory);
        return {
          job: parseNormalizedJob({
            companyId: context.companyId,
            sourceId: context.sourceId,
            externalJobId: String(job.publishId),
            title: title(job),
            department: job.positionDept ?? null,
            jobFamily: taxonomy.jobFamily,
            jobSubfamily: taxonomy.jobSubfamily,
            recruitmentCategory: options.category,
            locations: locations(job),
            employmentType: options.employmentType,
            experienceText: job.workYears ?? null,
            educationText: job.education ?? null,
            description: description(job),
            detailUrl: canonicalJobUrl(job.publishId),
            applyUrl: canonicalJobUrl(job.publishId),
            publishedAt:
              job.publishTime === null || job.publishTime === undefined
                ? null
                : utcInstant(job.publishTime),
          }),
          provenance: {
            title: '$.positionName|$.positionNameOpen',
            department: '$.positionDept',
            jobFamily: '$.jobDirection|$.jobCategory',
            locations: '$.workCity|$.requirementVoList[*].workCity',
            employmentType: `constant:${options.employmentType}`,
            experienceText: '$.workYears',
            educationText: '$.education',
            description: '$.workContent+$.qualification',
            publishedAt: '$.publishTime',
          },
          sourcePrivateJson: {
            reqId: job.reqId,
            jobCategory: job.jobCategory ?? null,
            planId: job.planId ?? null,
            tags: job.reqTagList ?? [],
          },
        };
      });
    },
    async healthCheck(context): Promise<SourceHealth> {
      const startedAt = Date.now();
      try {
        const response = await context.http.request({
          sourceKey: options.key,
          requestId: context.requestId,
          url: listEndpoint,
          allowedHosts: hosts,
          signal: context.signal,
          method: 'POST',
          headers: requestHeaders(),
          body: listBody({ ...context.config, pageSize: 1 }, 0),
          responseType: 'json',
          timeoutMs: context.timeoutMs,
        });
        const parsed = jdCampusListResponseSchema.parse(response.body);
        const ok = parsed.body.totalNumber > 0 && parsed.body.items.length > 0;
        return {
          status: ok ? 'healthy' : 'degraded',
          checkedAt: Date.now(),
          latencyMs: Date.now() - startedAt,
          signals: [
            {
              key: 'anonymous_campus_list_schema',
              ok,
              diagnostic: ok ? null : 'JD returned an empty campus list.',
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

/** 招聘来源适配器实例。 */
export const createJdCampusAdapter = (): JobSourceAdapter<JdCampusConfig, never> =>
  createJdChannelAdapter({ key: 'jd.campus', category: 'campus', employmentType: '校招' });

export const createJdInternAdapter = (): JobSourceAdapter<JdCampusConfig, never> =>
  createJdChannelAdapter({ key: 'jd.intern', category: 'internship', employmentType: '实习' });
