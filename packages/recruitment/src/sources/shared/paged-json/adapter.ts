import { parseNormalizedJob } from '@jobhunter/recruitment/domain';
import { utcInstant } from '@jobhunter/common/domain';
import {
  SourceError,
  canonicalizeOfficialUrl,
  type DiscoveryEvent,
  type JobSourceAdapter,
  type SourceHealth,
  type SourceHttpRequest,
  type SourceMetadata,
  type SourcePageCollectionRequest,
  type SourcePageCollectionResponseShape,
} from '@jobhunter/recruitment/source-contracts';
import type { z } from 'zod';
import { normalizeJobTaxonomy } from '../normalization/job-taxonomy.js';

/** 来源适配器使用的数据结构或契约。 */
export interface InlineJobFields {
  readonly externalJobId: string;
  readonly title: string;
  readonly description: string;
  readonly detailUrl: string;
  readonly applyUrl?: string;
  readonly department?: string | null;
  readonly taxonomyText?: string | null;
  readonly recruitmentCategory?: 'internship' | 'campus' | 'social' | null;
  readonly locations?: readonly string[];
  readonly employmentType?: string | null;
  readonly experienceText?: string | null;
  readonly educationText?: string | null;
  readonly publishedAtMs?: number | null;
  readonly provenance?: Readonly<Record<string, string>>;
  readonly sourcePrivateJson?: Readonly<Record<string, unknown>>;
}

/** 来源适配器使用的数据结构或契约。 */
export interface ParsedInlinePage<TRecord> {
  readonly records: readonly TRecord[];
  readonly total: number;
}

/** 来源适配器使用的数据结构或契约。 */
export interface InlinePagedJsonDefinition<TConfig, TRecord> {
  readonly metadata: SourceMetadata;
  readonly configSchema: z.ZodType<TConfig>;
  readonly pageSize: (config: TConfig) => number;
  readonly request: (context: {
    readonly config: TConfig;
    readonly page: number;
    readonly requestId: string;
    readonly signal: AbortSignal;
    readonly timeoutMs: number;
  }) => SourceHttpRequest;
  readonly parsePage: (body: unknown) => ParsedInlinePage<TRecord>;
  readonly parseRecord: (value: unknown) => TRecord;
  readonly fields: (record: TRecord) => InlineJobFields;
  /** 页数和原始行数完整时，允许去重后完成采集，重复数据不支持下架推断。 */
  readonly allowDuplicatePageRecords?: boolean;
  /** 过滤无法使用的已校验记录，但保留其分页计数并禁用本轮下架推断。 */
  readonly skipRecord?: (record: TRecord) => boolean;
  readonly browser?: {
    readonly listEndpointPath: string;
    readonly responseShape: SourcePageCollectionResponseShape;
  };
}

/** 执行来源数据的解析、转换、请求或分页逻辑。 */
function fallbackCategory(
  type: SourceMetadata['recruitmentType'],
): 'internship' | 'campus' | 'social' | null {
  return type === 'mixed' ? null : type;
}

/** 创建具备 JSON/浏览器分页双路径的 inline 来源适配器。 */
export function createInlinePagedJsonAdapter<TConfig, TRecord>(
  // 1、准备官方请求构造器；2、优先使用浏览器采集；3、否则走受限 JSON 分页；4、统一规范化职位。
  definition: InlinePagedJsonDefinition<TConfig, TRecord>,
): JobSourceAdapter<TConfig, never> {
  const officialHosts = definition.metadata.officialHosts;
  const actualCount = definition.browser?.responseShape === 'netease-jobs';
  const browserRequest = (context: {
    readonly requestId: string;
    readonly signal: AbortSignal;
    readonly timeoutMs: number;
    readonly config: TConfig;
  }): SourcePageCollectionRequest => ({
    sourceKey: definition.metadata.key,
    requestId: context.requestId,
    url: definition.metadata.canonicalEntryUrl,
    allowedHosts: officialHosts,
    signal: context.signal,
    timeoutMs: Math.max(context.timeoutMs, 120_000),
    maximumPages: 1_000,
    maximumResponseBytes: 2 * 1024 * 1024,
    pageSize: definition.pageSize(context.config),
    // 支持重复页恢复的来源，其普通分页与重读遵循相同限流，避免密集重放。
    ...(['xiaomi-jobs', 'netease-jobs'].includes(definition.browser?.responseShape ?? '')
      ? {
          minimumRequestIntervalMs: Math.ceil(
            60_000 / definition.metadata.defaultRateLimit.requestsPerMinute,
          ),
        }
      : {}),
    listEndpointPath: definition.browser?.listEndpointPath ?? '',
    responseShape: definition.browser?.responseShape ?? ('ats-job-posts' as const),
  });
  const requestPage = async (
    context: Parameters<JobSourceAdapter<TConfig, never>['discover']>[0],
    page: number,
  ): Promise<ParsedInlinePage<TRecord>> => {
    const response = await context.http.request({
      ...definition.request({
        config: context.config,
        page,
        requestId: context.requestId,
        signal: context.signal,
        timeoutMs: context.timeoutMs,
      }),
      responseType: 'json',
    });
    try {
      return definition.parsePage(response.body);
    } catch (error) {
      if (error instanceof SourceError) throw error;
      throw new SourceError(
        'parse_changed',
        `${definition.metadata.company.name} list response no longer matches its schema.`,
        { cause: error },
      );
    }
  };

  return {
    metadata: definition.metadata,
    configSchema: definition.configSchema,
    /** 执行来源适配器的该项操作。 */
    async *discover(context): AsyncIterable<DiscoveryEvent> {
      if (definition.browser && context.page?.collect) {
        const collection = await context.page.collect(browserRequest(context));
        const seen = new Set<string>();
        let discoveredCount = 0;
        let coverage = collection.coverage;
        for (const page of collection.pages) {
          for (const value of page.records) {
            const record = definition.parseRecord(value);
            const fields = definition.fields(record);
            if (seen.has(fields.externalJobId)) {
              if (!actualCount) coverage = 'partial';
              continue;
            }
            seen.add(fields.externalJobId);
            discoveredCount += 1;
            yield {
              type: 'job',
              job: {
                externalJobId: fields.externalJobId,
                sourceUrl: canonicalizeOfficialUrl(fields.detailUrl, officialHosts),
                raw: record,
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
        return;
      }
      const pageSize = definition.pageSize(context.config);
      const seen = new Set<string>();
      let expectedTotal: number | null = null;
      let expectedPages = 1;
      let totalChanged = false;
      let paginationChanged = false;
      let duplicateIds = 0;
      let returnedCount = 0;
      let skippedRecords = 0;
      let discoveredCount = 0;
      let fetchedPages = 0;

      for (let page = 1; page <= expectedPages; page += 1) {
        if (context.signal.aborted)
          throw new SourceError('temporary', 'Source discovery was aborted.');
        const parsed = await requestPage(context, page);
        returnedCount += parsed.records.length;
        fetchedPages = page;
        if (expectedTotal === null) {
          expectedTotal = parsed.total;
          expectedPages = Math.max(1, Math.ceil(expectedTotal / pageSize));
        } else if (parsed.total !== expectedTotal) {
          totalChanged = true;
          if (!actualCount || Math.max(1, Math.ceil(parsed.total / pageSize)) !== expectedPages)
            paginationChanged = true;
        }
        if (parsed.records.length > pageSize) {
          throw new SourceError(
            'parse_changed',
            'Source returned more jobs than the requested page size.',
          );
        }
        for (const value of parsed.records) {
          const record = definition.parseRecord(value);
          if (definition.skipRecord?.(record)) {
            skippedRecords += 1;
            continue;
          }
          const fields = definition.fields(record);
          if (seen.has(fields.externalJobId)) {
            duplicateIds += 1;
            continue;
          }
          seen.add(fields.externalJobId);
          discoveredCount += 1;
          yield {
            type: 'job',
            job: {
              externalJobId: fields.externalJobId,
              sourceUrl: canonicalizeOfficialUrl(fields.detailUrl, officialHosts),
              raw: record,
            },
          };
        }
        yield { type: 'page', page, discoveredCount };
        if (parsed.records.length === 0 && page < expectedPages) break;
      }

      const complete =
        !paginationChanged &&
        (actualCount ||
          (definition.allowDuplicatePageRecords
            ? returnedCount === expectedTotal
            : duplicateIds === 0 && discoveredCount + skippedRecords === expectedTotal)) &&
        fetchedPages === expectedPages;
      yield {
        type: 'complete',
        coverage: complete ? 'complete' : 'partial',
        cursor: null,
        pages: fetchedPages,
        discoveredCount,
        diagnostics: {
          reason: complete
            ? null
            : paginationChanged
              ? 'pagination_total_changed'
              : duplicateIds > 0
                ? 'duplicate_job_ids'
                : 'discovered_count_mismatch',
          retryable: paginationChanged,
          ...(actualCount || definition.allowDuplicatePageRecords || skippedRecords > 0
            ? {
                absenceReliable:
                  duplicateIds === 0 && !totalChanged && discoveredCount === expectedTotal,
              }
            : {}),
          expectedCount: expectedTotal,
          discoveredCount,
          expectedPages,
          fetchedPages,
          duplicateIds,
          totalChanged,
        },
      };
    },
    /** 执行来源适配器的该项操作。 */
    normalize(input, context) {
      const record = definition.parseRecord(input.discovered.raw);
      const fields = definition.fields(record);
      if (fields.externalJobId !== input.discovered.externalJobId)
        throw new SourceError('parse_changed', 'Discovered and normalized job identity differs.');
      const taxonomy = normalizeJobTaxonomy(fields.taxonomyText ?? fields.title);
      const category =
        fields.recruitmentCategory ?? fallbackCategory(definition.metadata.recruitmentType);
      const detailUrl = canonicalizeOfficialUrl(fields.detailUrl, officialHosts);
      const applyUrl = canonicalizeOfficialUrl(fields.applyUrl ?? fields.detailUrl, officialHosts);
      return Promise.resolve({
        job: parseNormalizedJob({
          companyId: context.companyId,
          sourceId: context.sourceId,
          externalJobId: fields.externalJobId,
          title: fields.title,
          department: fields.department ?? null,
          jobFamily: taxonomy.jobFamily,
          jobSubfamily: taxonomy.jobSubfamily,
          recruitmentCategory: category,
          locations: [...(fields.locations ?? [])],
          employmentType: fields.employmentType ?? null,
          experienceText: fields.experienceText ?? null,
          educationText: fields.educationText ?? null,
          description: fields.description,
          detailUrl,
          applyUrl,
          publishedAt:
            fields.publishedAtMs === null || fields.publishedAtMs === undefined
              ? null
              : utcInstant(fields.publishedAtMs),
        }),
        provenance: fields.provenance ?? {},
        sourcePrivateJson: fields.sourcePrivateJson ?? {},
      });
    },
    async healthCheck(context): Promise<SourceHealth> {
      const startedAt = Date.now();
      try {
        if (definition.browser && context.page?.collect) {
          const collection = await context.page.collect(browserRequest(context));
          const count = collection.pages.reduce((sum, page) => sum + page.records.length, 0);
          const ok = count > 0 && collection.coverage !== 'unknown';
          return {
            status: ok ? 'healthy' : 'degraded',
            checkedAt: Date.now(),
            latencyMs: Date.now() - startedAt,
            signals: [
              {
                key: 'anonymous_browser_list',
                ok,
                diagnostic: ok ? null : 'Browser collection returned no usable jobs.',
              },
            ],
            errorCategory: null,
          };
        }
        const page = await requestPage({ ...context, cursor: null }, 1);
        const ok = page.total > 0 && page.records.length > 0;
        return {
          status: ok ? 'healthy' : 'degraded',
          checkedAt: Date.now(),
          latencyMs: Date.now() - startedAt,
          signals: [{ key: 'anonymous_job_list', ok, diagnostic: ok ? null : 'No jobs returned.' }],
          errorCategory: null,
        };
      } catch (error) {
        const sourceError =
          error instanceof SourceError
            ? error
            : new SourceError('temporary', 'Source health check failed.', { cause: error });
        return {
          status: 'unhealthy',
          checkedAt: Date.now(),
          latencyMs: Date.now() - startedAt,
          signals: [{ key: 'anonymous_job_list', ok: false, diagnostic: sourceError.message }],
          errorCategory: sourceError.category,
        };
      }
    },
  };
}
