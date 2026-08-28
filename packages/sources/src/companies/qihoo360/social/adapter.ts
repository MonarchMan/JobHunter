import { parseNormalizedJob } from '@jobhunter/domain';
import {
  SourceError,
  canonicalizeOfficialUrl,
  type DiscoveryEvent,
  type JobSourceAdapter,
  type SourceHealth,
  type SourcePageCollectionRequest,
  type SourcePageClient,
  type SourcePageCollection,
} from '@jobhunter/source-core';
import { normalizeJobTaxonomy } from '../../../shared/normalization/job-taxonomy.js';
import {
  qihoo360ConfigSchema,
  qihoo360DetailResponseSchema,
  qihoo360JobSchema,
  type Qihoo360Config,
  type Qihoo360Detail,
} from './schemas.js';

const hosts = ['hr.360.cn'] as const;
const entryUrl = 'https://hr.360.cn/hr/list';

function browserRequest(context: {
  readonly requestId: string;
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
}): SourcePageCollectionRequest {
  return {
    sourceKey: 'qihoo360.social',
    requestId: context.requestId,
    url: entryUrl,
    allowedHosts: hosts,
    signal: context.signal,
    timeoutMs: Math.max(context.timeoutMs, 60_000),
    maximumPages: 10,
    maximumResponseBytes: 2 * 1024 * 1024,
    listEndpointPath: '/v2/index/getlistsearch',
    responseShape: 'qihoo360-jobs' as const,
  };
}

function collect(context: {
  readonly page?: SourcePageClient;
  readonly requestId: string;
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
}): Promise<SourcePageCollection> {
  if (!context.page?.collect)
    throw new SourceError('access_blocked', '360 requires a normal anonymous browser session.');
  return context.page.collect(browserRequest(context));
}

export function createQihoo360SocialAdapter(): JobSourceAdapter<Qihoo360Config, Qihoo360Detail> {
  return {
    metadata: {
      key: 'qihoo360.social',
      version: '1.0.0',
      company: { slug: 'qihoo360', name: '360' },
      recruitmentType: 'social',
      canonicalEntryUrl: entryUrl,
      officialHosts: [...hosts],
      capabilities: { detail: 'deferred', pagination: 'page', transport: 'browser' },
      defaultRateLimit: { requestsPerMinute: 6, burst: 1 },
      externalIdFingerprintVersion: null,
    },
    configSchema: qihoo360ConfigSchema,
    async *discover(context): AsyncIterable<DiscoveryEvent> {
      const collection = await collect(context);
      let discoveredCount = 0;
      const seen = new Set<string>();
      let coverage = collection.coverage;
      for (const page of collection.pages) {
        for (const value of page.records) {
          const job = qihoo360JobSchema.parse(value);
          if (seen.has(job.id)) {
            coverage = 'partial';
            continue;
          }
          seen.add(job.id);
          discoveredCount += 1;
          yield {
            type: 'job',
            job: {
              externalJobId: job.id,
              sourceUrl: canonicalizeOfficialUrl(`https://hr.360.cn/hr/detail/${job.id}`, hosts),
              raw: job,
            },
          };
        }
        yield { type: 'page', page: page.page, discoveredCount };
      }
      yield {
        type: 'complete',
        coverage,
        cursor: null,
        pages: collection.pages.length,
        discoveredCount,
        ...(collection.diagnostics ? { diagnostics: collection.diagnostics } : {}),
      };
    },
    async fetchDetail(job, context) {
      const detailUrl = canonicalizeOfficialUrl(
        `https://hr.360.cn/hr/detail/${job.externalJobId}`,
        hosts,
      );
      const url = new URL('https://hr.360.cn/v2/index/getjobone');
      url.searchParams.set('id', job.externalJobId);
      const response = await context.http.request({
        sourceKey: 'qihoo360.social',
        requestId: context.requestId,
        url: url.toString(),
        allowedHosts: hosts,
        signal: context.signal,
        timeoutMs: context.timeoutMs,
        responseType: 'json',
        headers: {
          referer: detailUrl,
          'x-requested-with': 'XMLHttpRequest',
        },
      });
      const detail = qihoo360DetailResponseSchema.parse(response.body).data;
      if (detail.id !== job.externalJobId) {
        throw new SourceError('parse_changed', '360 detail identity differs from the list job.');
      }
      return detail;
    },
    normalize(input, context) {
      const job = qihoo360JobSchema.parse(input.discovered.raw);
      const detail = input.detail;
      const taxonomy = normalizeJobTaxonomy(job.position ?? job.type ?? job.title);
      const url = canonicalizeOfficialUrl(`https://hr.360.cn/hr/detail/${job.id}`, hosts);
      return Promise.resolve({
        job: parseNormalizedJob({
          companyId: context.companyId,
          sourceId: context.sourceId,
          externalJobId: job.id,
          title: job.title,
          department: null,
          jobFamily: taxonomy.jobFamily,
          jobSubfamily: taxonomy.jobSubfamily,
          recruitmentCategory: 'social',
          locations: job.area ? [job.area] : [],
          employmentType: '全职',
          experienceText: detail?.year ?? null,
          educationText: null,
          description:
            detail === null
              ? [job.type, job.position, job.area].filter(Boolean).join(' / ')
              : [detail.description, detail.qualification].filter(Boolean).join('\n\n'),
          detailUrl: url,
          applyUrl: url,
          publishedAt: null,
        }),
        provenance: {
          title: '$.title',
          locations: '$.area',
          description: detail === null ? '$.type+$.position' : '$detail.description+qualification',
        },
        sourcePrivateJson: { publishedDate: job.date ?? null },
      });
    },
    async healthCheck(context): Promise<SourceHealth> {
      const startedAt = Date.now();
      try {
        const collection = await collect(context);
        const count = collection.pages.reduce((sum, page) => sum + page.records.length, 0);
        const ok = count > 0 && collection.coverage === 'complete';
        return {
          status: ok ? 'healthy' : 'degraded',
          checkedAt: Date.now(),
          latencyMs: Date.now() - startedAt,
          signals: [
            { key: 'anonymous_browser_list', ok, diagnostic: ok ? null : 'Collection incomplete.' },
          ],
          errorCategory: null,
        };
      } catch (error) {
        const sourceError =
          error instanceof SourceError
            ? error
            : new SourceError('temporary', '360 health check failed.', { cause: error });
        return {
          status: 'unhealthy',
          checkedAt: Date.now(),
          latencyMs: Date.now() - startedAt,
          signals: [{ key: 'anonymous_browser_list', ok: false, diagnostic: sourceError.message }],
          errorCategory: sourceError.category,
        };
      }
    },
  };
}
