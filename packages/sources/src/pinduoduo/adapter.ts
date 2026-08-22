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
  pinduoduoConfigSchema,
  pinduoduoJobSchema,
  pinduoduoListResponseSchema,
  type PinduoduoConfig,
  type PinduoduoJob,
} from './schemas.js';

const hosts = ['careers.pddglobalhr.com'] as const;
const entryUrl = 'https://careers.pddglobalhr.com/campus/intern';
const listEndpoint = 'https://careers.pddglobalhr.com/api/careers/api/recruit/position/train/list';

function parseSource<T>(parse: () => T, diagnostic: string): T {
  try {
    return parse();
  } catch (error) {
    if (error instanceof SourceError) throw error;
    throw new SourceError('parse_changed', diagnostic, { cause: error });
  }
}

function requestHeaders(): Readonly<Record<string, string>> {
  return {
    'content-type': 'application/json',
    origin: 'https://careers.pddglobalhr.com',
    referer: entryUrl,
  };
}

function listBody(config: PinduoduoConfig, page: number): string {
  return JSON.stringify({ page, pageSize: config.pageSize, t: config.token });
}

function jobUrl(externalJobId: string): string {
  return canonicalizeOfficialUrl(
    `${entryUrl}/detail?positionId=${encodeURIComponent(externalJobId)}`,
    hosts,
  );
}

function locations(job: PinduoduoJob): string[] {
  return [job.workLocationName, job.workLocation]
    .filter((value): value is string => Boolean(value?.trim()) && value !== '/')
    .map((value) => value.trim());
}

function description(job: PinduoduoJob): string {
  const text = job.jobDuty?.trim();
  if (!text) throw new SourceError('parse_changed', 'Pinduoduo job has no usable description.');
  return text;
}

function healthFailure(error: unknown, startedAt: number): SourceHealth {
  const sourceError =
    error instanceof SourceError
      ? error
      : new SourceError(
          'parse_changed',
          error instanceof ZodError
            ? 'Pinduoduo list response schema changed.'
            : 'Pinduoduo health check failed.',
          { cause: error },
        );
  return {
    status: sourceError.category === 'temporary' ? 'degraded' : 'unhealthy',
    checkedAt: Date.now(),
    latencyMs: Date.now() - startedAt,
    signals: [
      { key: 'anonymous_intern_list_schema', ok: false, diagnostic: sourceError.safeDiagnostic },
    ],
    errorCategory: sourceError.category,
  };
}

export function createPinduoduoAdapter(): JobSourceAdapter<PinduoduoConfig, never> {
  return {
    metadata: {
      key: 'pinduoduo.intern',
      version: '1.0.0',
      company: { slug: 'pinduoduo', name: '拼多多' },
      recruitmentType: 'campus',
      canonicalEntryUrl: entryUrl,
      officialHosts: [...hosts],
      capabilities: { detail: 'inline', pagination: 'page', transport: 'json' },
      defaultRateLimit: { requestsPerMinute: 6, burst: 1 },
      externalIdFingerprintVersion: null,
    },
    configSchema: pinduoduoConfigSchema,
    async *discover(context): AsyncIterable<DiscoveryEvent> {
      const firstPage = 1;
      let page = firstPage;
      let expectedCount = 0;
      let discoveredCount = 0;
      let coverage: 'complete' | 'partial' = 'complete';
      const seen = new Set<string>();

      for (;;) {
        if (context.signal.aborted) {
          throw new SourceError('temporary', 'Pinduoduo discovery was aborted.');
        }
        const response = await context.http.request({
          sourceKey: 'pinduoduo.intern',
          requestId: context.requestId,
          url: listEndpoint,
          allowedHosts: hosts,
          signal: context.signal,
          method: 'POST',
          headers: requestHeaders(),
          body: listBody(context.config, page),
          responseType: 'json',
          timeoutMs: context.timeoutMs,
        });
        const parsed = parseSource(
          () => pinduoduoListResponseSchema.parse(response.body),
          'Pinduoduo intern list response no longer matches the verified schema.',
        );
        if (page === firstPage) expectedCount = parsed.result.total;
        if (expectedCount !== parsed.result.total) coverage = 'partial';
        if (parsed.result.list.length > context.config.pageSize) coverage = 'partial';

        for (const raw of parsed.result.list) {
          if (seen.has(raw.id)) {
            coverage = 'partial';
            continue;
          }
          seen.add(raw.id);
          discoveredCount += 1;
          yield { type: 'job', job: { externalJobId: raw.id, sourceUrl: jobUrl(raw.id), raw } };
        }
        yield { type: 'page', page, discoveredCount };

        if (discoveredCount >= expectedCount || parsed.result.list.length === 0) break;
        if (parsed.result.list.length < context.config.pageSize) {
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
      };
    },
    normalize(input, context) {
      return Promise.resolve().then(() => {
        const job = parseSource(
          () => pinduoduoJobSchema.parse(input.discovered.raw),
          'Pinduoduo discovered job no longer matches the verified schema.',
        );
        return {
          job: parseNormalizedJob({
            companyId: context.companyId,
            sourceId: context.sourceId,
            externalJobId: job.id,
            title: job.name,
            department: null,
            jobFamily: job.jobName ?? job.job ?? null,
            locations: locations(job),
            employmentType: '实习',
            experienceText: null,
            educationText: job.graduationYear ? `${job.graduationYear}届在校生` : null,
            description: description(job),
            detailUrl: jobUrl(job.id),
            applyUrl: jobUrl(job.id),
            publishedAt:
              job.releaseTime === null || job.releaseTime === undefined
                ? null
                : utcInstant(job.releaseTime),
          }),
          provenance: {
            title: '$.name',
            jobFamily: '$.jobName|$.job',
            locations: '$.workLocationName|$.workLocation',
            employmentType: 'constant:实习',
            educationText: '$.graduationYear',
            description: '$.jobDuty',
            publishedAt: '$.releaseTime',
          },
          sourcePrivateJson: {
            code: job.code,
            labels: job.labelList ?? [],
            recruitTypeName: job.recruitTypeName ?? null,
          },
        };
      });
    },
    async healthCheck(context): Promise<SourceHealth> {
      const startedAt = Date.now();
      try {
        const response = await context.http.request({
          sourceKey: 'pinduoduo.intern',
          requestId: context.requestId,
          url: listEndpoint,
          allowedHosts: hosts,
          signal: context.signal,
          method: 'POST',
          headers: requestHeaders(),
          body: listBody({ ...context.config, pageSize: 1 }, 1),
          responseType: 'json',
          timeoutMs: context.timeoutMs,
        });
        const parsed = pinduoduoListResponseSchema.parse(response.body);
        const ok = parsed.result.total > 0 && parsed.result.list.length > 0;
        return {
          status: ok ? 'healthy' : 'degraded',
          checkedAt: Date.now(),
          latencyMs: Date.now() - startedAt,
          signals: [
            {
              key: 'anonymous_intern_list_schema',
              ok,
              diagnostic: ok ? null : 'Pinduoduo returned an empty intern list.',
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
