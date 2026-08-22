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
  jdConfigSchema,
  jdJobSchema,
  jdListResponseSchema,
  type JdConfig,
  type JdJob,
} from './schemas.js';

const hosts = ['zhaopin.jd.com'] as const;
const entryUrl = 'https://zhaopin.jd.com/web/job/job_info_list/3';
const countEndpoint = 'https://zhaopin.jd.com/web/job/job_count';
const listEndpoint = 'https://zhaopin.jd.com/web/job/job_list';

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
    'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
    referer,
  };
}

function formBody(values: Readonly<Record<string, string>>): string {
  return new URLSearchParams(values).toString();
}

function countBody(config: JdConfig): string {
  return formBody({
    workCityJson: '[]',
    jobTypeJson: '[]',
    jobSearch: config.keyword,
    depTypeJson: '[]',
  });
}

function listBody(config: JdConfig, page: number): string {
  return formBody({
    pageIndex: String(page),
    pageSize: String(config.pageSize),
    workCityJson: '[]',
    jobTypeJson: '[]',
    jobSearch: config.keyword,
    depTypeJson: '[]',
  });
}

function canonicalJobUrl(): string {
  return canonicalizeOfficialUrl(entryUrl, hosts);
}

function parseCount(value: string): number {
  const count = Number(value.trim());
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new SourceError('parse_changed', 'JD returned an invalid public job count.');
  }
  return count;
}

function parseList(value: string): JdJob[] {
  return jdListResponseSchema.parse(JSON.parse(value) as unknown);
}

function optionalText(...values: readonly (string | null | undefined)[]): string | null {
  for (const value of values) {
    if (value?.trim()) return value;
  }
  return null;
}

function locations(value: string | null | undefined): string[] {
  return (value ?? '')
    .split(/[，,、/]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function description(job: JdJob): string {
  return [
    job.workContent ? `岗位职责\n${job.workContent}` : null,
    job.qualification ? `任职要求\n${job.qualification}` : null,
  ]
    .filter((value): value is string => value !== null)
    .join('\n\n');
}

export function createJdAdapter(): JobSourceAdapter<JdConfig, never> {
  return {
    metadata: {
      key: 'jd.social',
      version: '1.0.0',
      company: { slug: 'jd', name: '京东' },
      recruitmentType: 'social',
      canonicalEntryUrl: entryUrl,
      officialHosts: [...hosts],
      capabilities: { detail: 'inline', pagination: 'page', transport: 'json' },
      defaultRateLimit: { requestsPerMinute: 12, burst: 1 },
      externalIdFingerprintVersion: null,
    },
    configSchema: jdConfigSchema,
    async *discover(context): AsyncIterable<DiscoveryEvent> {
      const countResponse = await context.http.request<string>({
        sourceKey: 'jd.social',
        requestId: context.requestId,
        url: countEndpoint,
        allowedHosts: hosts,
        signal: context.signal,
        method: 'POST',
        headers: requestHeaders(entryUrl),
        body: countBody(context.config),
        responseType: 'text',
        timeoutMs: context.timeoutMs,
      });
      const expectedCount = parseSource(
        () => parseCount(countResponse.body),
        'JD count response no longer matches the verified schema.',
      );
      const expectedPages = Math.ceil(expectedCount / context.config.pageSize);
      const seen = new Set<string>();
      let discoveredCount = 0;
      let coverage: 'complete' | 'partial' = 'complete';
      let page = 1;

      for (; page <= expectedPages; page += 1) {
        if (context.signal.aborted) {
          throw new SourceError('temporary', 'JD discovery was aborted.');
        }
        const response = await context.http.request<string>({
          sourceKey: 'jd.social',
          requestId: context.requestId,
          url: listEndpoint,
          allowedHosts: hosts,
          signal: context.signal,
          method: 'POST',
          headers: requestHeaders(entryUrl),
          body: listBody(context.config, page),
          responseType: 'text',
          timeoutMs: context.timeoutMs,
        });
        const parsed = parseSource(
          () => parseList(response.body),
          'JD list response no longer matches the verified schema.',
        );
        if (
          parsed.length > context.config.pageSize ||
          (parsed.length === 0 && page < expectedPages)
        ) {
          coverage = 'partial';
        }
        for (const raw of parsed) {
          const externalJobId = String(raw.requirementId);
          if (seen.has(externalJobId)) {
            coverage = 'partial';
            continue;
          }
          seen.add(externalJobId);
          discoveredCount += 1;
          yield {
            type: 'job',
            job: { externalJobId, sourceUrl: canonicalJobUrl(), raw },
          };
        }
        yield { type: 'page', page, discoveredCount };
        if (parsed.length < context.config.pageSize && page < expectedPages) {
          coverage = 'partial';
          break;
        }
      }

      if (discoveredCount !== expectedCount || page - 1 !== expectedPages) coverage = 'partial';
      yield {
        type: 'complete',
        coverage,
        cursor: null,
        pages: Math.max(0, page - 1),
        discoveredCount,
      };
    },
    normalize(input, context) {
      return Promise.resolve().then(() => {
        const job = parseSource(
          () => jdJobSchema.parse(input.discovered.raw),
          'JD discovered job no longer matches the verified schema.',
        );
        const text = description(job);
        if (!text) throw new SourceError('parse_changed', 'JD job contains no usable description.');
        return {
          job: parseNormalizedJob({
            companyId: context.companyId,
            sourceId: context.sourceId,
            externalJobId: String(job.requirementId),
            title: job.positionNameOpen,
            department: optionalText(job.positionDeptName),
            jobFamily: optionalText(job.jobType),
            locations: locations(job.workCity),
            employmentType: null,
            experienceText: null,
            educationText: null,
            description: text,
            detailUrl: canonicalJobUrl(),
            applyUrl: canonicalJobUrl(),
            publishedAt:
              job.publishTime === null || job.publishTime === undefined
                ? null
                : utcInstant(job.publishTime),
          }),
          provenance: {
            title: '$.positionNameOpen',
            department: '$.positionDeptName',
            jobFamily: '$.jobType',
            locations: '$.workCity',
            description: '$.workContent+$.qualification',
            publishedAt: '$.publishTime|$.formatPublishTime',
          },
          sourcePrivateJson: {
            positionId: job.positionId,
            positionCode: job.positionCode,
            jobTypeCode: job.jobTypeCode ?? null,
            workCityCode: job.workCityCode ?? null,
          },
        };
      });
    },
    async healthCheck(context): Promise<SourceHealth> {
      const startedAt = Date.now();
      try {
        const countResponse = await context.http.request<string>({
          sourceKey: 'jd.social',
          requestId: context.requestId,
          url: countEndpoint,
          allowedHosts: hosts,
          signal: context.signal,
          method: 'POST',
          headers: requestHeaders(entryUrl),
          body: countBody(context.config),
          responseType: 'text',
          timeoutMs: context.timeoutMs,
        });
        const count = parseCount(countResponse.body);
        const listResponse = await context.http.request<string>({
          sourceKey: 'jd.social',
          requestId: context.requestId,
          url: listEndpoint,
          allowedHosts: hosts,
          signal: context.signal,
          method: 'POST',
          headers: requestHeaders(entryUrl),
          body: listBody({ ...context.config, pageSize: 1 }, 1),
          responseType: 'text',
          timeoutMs: context.timeoutMs,
        });
        const list = parseList(listResponse.body);
        const ok = count > 0 && list.length > 0;
        return {
          status: ok ? 'healthy' : 'degraded',
          checkedAt: Date.now(),
          latencyMs: Date.now() - startedAt,
          signals: [
            {
              key: 'anonymous_inline_list_schema',
              ok,
              diagnostic: ok ? null : 'JD returned an empty public list.',
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
                  ? 'JD list response schema changed.'
                  : 'JD health check failed.',
                { cause: error },
              );
        return {
          status: sourceError.category === 'temporary' ? 'degraded' : 'unhealthy',
          checkedAt: Date.now(),
          latencyMs: Date.now() - startedAt,
          signals: [
            {
              key: 'anonymous_inline_list_schema',
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
