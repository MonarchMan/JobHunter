import { parseNormalizedJob, utcInstant } from '@jobhunter/domain';
import { normalizeJobTaxonomy } from '../job-taxonomy.js';
import { normalizeRecruitmentCategory } from '../recruitment-category.js';
import {
  SourceError,
  canonicalizeOfficialUrl,
  type DiscoveryEvent,
  type JobSourceAdapter,
  type SourceHealth,
  type SourceHttpRequest,
  type SourcePageCollection,
  type SourcePageCollectionResponseShape,
} from '@jobhunter/source-core';
import { ZodError } from 'zod';
import { scriptedConfigSchema, type ScriptedConfig } from './schemas.js';

type RecordValue = Record<string, unknown>;

export interface ScriptedAdapterDefinition {
  readonly key: string;
  readonly company: { readonly slug: string; readonly name: string };
  readonly recruitmentType: 'campus' | 'social' | 'mixed';
  readonly entryUrl: string;
  readonly hosts: readonly string[];
  readonly transport?: 'json' | 'browser';
  readonly browser?: {
    readonly listEndpointPath: string;
    readonly responseShape: SourcePageCollectionResponseShape;
  };
  readonly requiresRuntimeToken?: 'signature' | 'xiaohongshu';
  readonly recordSchema: { parse(value: unknown): RecordValue };
  readonly request: (context: {
    readonly config: ScriptedConfig;
    readonly page: number;
    readonly requestId: string;
    readonly signal: AbortSignal;
    readonly timeoutMs: number;
  }) => SourceHttpRequest;
}

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function firstText(record: RecordValue, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = text(record[key]);
    if (value) return value;
  }
  return null;
}

function recruitmentCategoryFor(
  record: RecordValue,
  fallback: ScriptedAdapterDefinition['recruitmentType'],
) {
  const explicit = firstText(record, [
    'employmentType',
    'recruitTypeName',
    'recruitmentType',
    'projectType',
    'projectName',
  ]);
  const semanticText = [
    explicit,
    firstText(record, ['title', 'name', 'positionName', 'positionNameOpen', 'jobName']),
    firstText(record, [
      'description',
      'workContent',
      'jobDuty',
      'jobDesc',
      'requirement',
      'qualification',
    ]),
  ]
    .filter((value): value is string => value !== null)
    .join('\n');

  // A record-level internship signal is stronger than a campus/social source
  // descriptor. This covers provider labels such as 日常实习 and 暑期实习.
  if (normalizeRecruitmentCategory(semanticText) === 'internship') return 'internship';
  return normalizeRecruitmentCategory(explicit ?? fallback);
}

function findArray(value: unknown, depth = 0): RecordValue[] | null {
  if (depth > 4) return null;
  if (Array.isArray(value) && value.every(isRecord)) return value;
  if (!isRecord(value)) return null;
  for (const key of [
    'list',
    'items',
    'records',
    'posts',
    'positions',
    'job_post_list',
    'data',
    'result',
    'body',
  ]) {
    const found = findArray(value[key], depth + 1);
    if (found) return found;
  }
  for (const nested of Object.values(value)) {
    const found = findArray(nested, depth + 1);
    if (found) return found;
  }
  return null;
}

function findNumber(value: unknown, keys: readonly string[], depth = 0): number | null {
  if (depth > 4 || !isRecord(value)) return null;
  for (const key of keys) {
    const candidate = Number(value[key]);
    if (Number.isSafeInteger(candidate) && candidate >= 0) return candidate;
  }
  for (const key of ['data', 'result', 'body']) {
    const nested = findNumber(value[key], keys, depth + 1);
    if (nested !== null) return nested;
  }
  return null;
}

function parsePage(
  body: unknown,
  pageSize: number,
): { readonly items: RecordValue[]; readonly total: number } {
  const items = findArray(body);
  if (!items)
    throw new SourceError('parse_changed', 'Scripted source returned no recognizable job list.');
  const total =
    findNumber(body, [
      'total',
      'totalCount',
      'totalNumber',
      'count',
      'totalNum',
      'job_post_list_count',
    ]) ?? items.length;
  return { items, total: Math.max(total, items.length > pageSize ? 0 : items.length) };
}

function externalId(job: RecordValue): string | null {
  return firstText(job, [
    'id',
    'publishId',
    'positionId',
    'jobId',
    'job_id',
    'reqId',
    'requirementId',
    'positionCode',
    'code',
  ]);
}

function title(job: RecordValue): string | null {
  return firstText(job, [
    'title',
    'name',
    'positionName',
    'positionNameOpen',
    'jobName',
    'jobNameNew',
    'postName',
  ]);
}

function description(job: RecordValue): string | null {
  const values = [
    'description',
    'jobDuty',
    'workContent',
    'qualification',
    'duty',
    'jobDesc',
    'jobRequire',
    'jobDescription',
    'requirement',
    'responsibility',
    'content',
  ]
    .map((key) => text(job[key]))
    .filter((value): value is string => value !== null);
  return values.length > 0 ? values.join('\n\n') : null;
}

function locations(job: RecordValue): string[] {
  const values: string[] = [];
  for (const key of [
    'location',
    'workLocation',
    'workLocationName',
    'workCity',
    'city',
    'workplace',
    'workLocations',
    'workPlace',
    'jobAddress',
    'cityName',
  ]) {
    const value = job[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        const parsed = text(item);
        if (parsed) values.push(parsed);
      }
    } else {
      const parsed = text(value);
      if (parsed) values.push(...parsed.split(/[，,、/]/));
    }
  }
  return values.map((value) => value.trim()).filter((value) => value && value !== '/');
}

function publishedAt(job: RecordValue): number | null {
  for (const key of [
    'publishedAt',
    'publishTime',
    'releaseTime',
    'publish_time',
    'createTime',
    'releaseDate',
    'lastUpdateDate',
    'deployDate',
    'modifyTime',
  ]) {
    const value = job[key];
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
    if (typeof value === 'string' && value.trim()) {
      const timestamp = Date.parse(value);
      if (Number.isFinite(timestamp)) return timestamp;
    }
  }
  return null;
}

function browserRequest(
  definition: ScriptedAdapterDefinition,
  context: {
    readonly requestId: string;
    readonly signal: AbortSignal;
    readonly timeoutMs: number;
  },
): {
  readonly sourceKey: string;
  readonly requestId: string;
  readonly url: string;
  readonly allowedHosts: readonly string[];
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
  readonly maximumPages: number;
  readonly maximumResponseBytes: number;
  readonly listEndpointPath: string;
  readonly responseShape: SourcePageCollectionResponseShape;
} {
  return {
    sourceKey: definition.key,
    requestId: context.requestId,
    url: definition.entryUrl,
    allowedHosts: definition.hosts,
    listEndpointPath: definition.browser?.listEndpointPath ?? '',
    responseShape: definition.browser?.responseShape ?? 'ats-job-posts',
    signal: context.signal,
    // Browser collection covers navigation plus pagination. The ordinary
    // per-request timeout is too short for a multi-page rendered list.
    timeoutMs: Math.max(context.timeoutMs, 120_000),
    maximumPages: 1_000,
    maximumResponseBytes: 2 * 1024 * 1024,
  };
}

function requestFailure(error: unknown, message: string): SourceError {
  if (error instanceof SourceError) return error;
  return new SourceError('parse_changed', error instanceof ZodError ? message : message, {
    cause: error,
  });
}

export function createScriptedAdapter(
  definition: ScriptedAdapterDefinition,
): JobSourceAdapter<ScriptedConfig, never> {
  const entryUrl = canonicalizeOfficialUrl(definition.entryUrl, definition.hosts);
  const request = (
    context: Parameters<ScriptedAdapterDefinition['request']>[0],
  ): SourceHttpRequest => definition.request(context);

  const parseRecord = (value: unknown): RecordValue => {
    try {
      return definition.recordSchema.parse(value);
    } catch (error) {
      throw new SourceError(
        'parse_changed',
        `${definition.company.name} job record no longer matches the verified schema.`,
        { cause: error },
      );
    }
  };

  const checkRuntimeToken = (config: ScriptedConfig): void => {
    if (definition.requiresRuntimeToken === 'signature' && !config.signature) {
      throw new SourceError(
        'access_blocked',
        `${definition.company.name} requires a provider-issued request signature.`,
      );
    }
    if (
      definition.requiresRuntimeToken === 'xiaohongshu' &&
      (!config.xS || !config.xSCommon || !config.xT)
    ) {
      throw new SourceError(
        'access_blocked',
        '小红书 requires a current anonymous browser session token.',
      );
    }
  };

  return {
    metadata: {
      key: definition.key,
      version: '1.0.0',
      company: definition.company,
      recruitmentType: definition.recruitmentType,
      canonicalEntryUrl: entryUrl,
      officialHosts: [...definition.hosts],
      capabilities: {
        detail: 'inline',
        pagination: 'page',
        transport: definition.transport ?? 'json',
      },
      defaultRateLimit: { requestsPerMinute: 6, burst: 1 },
      externalIdFingerprintVersion: null,
    },
    configSchema: scriptedConfigSchema,
    async *discover(context): AsyncIterable<DiscoveryEvent> {
      if (definition.transport === 'browser') {
        if (!context.page?.collect) {
          throw new SourceError(
            'access_blocked',
            `${definition.company.name} requires a normal browser collection session.`,
          );
        }
        const collection: SourcePageCollection = await context.page.collect(
          browserRequest(definition, context),
        );
        const seen = new Set<string>();
        let discoveredCount = 0;
        let expectedCount: number | null = null;
        let coverage: 'complete' | 'partial' | 'unknown' = collection.coverage;
        for (const collectedPage of collection.pages) {
          if (collectedPage.total !== null) {
            expectedCount ??= collectedPage.total;
            if (expectedCount !== collectedPage.total) coverage = 'partial';
          }
          for (const value of collectedPage.records) {
            const raw = parseRecord(value);
            const id = externalId(raw);
            if (!id)
              throw new SourceError(
                'parse_changed',
                `${definition.company.name} browser record has no stable ID.`,
              );
            if (seen.has(id)) {
              coverage = 'partial';
              continue;
            }
            seen.add(id);
            discoveredCount += 1;
            const sourceUrl = canonicalizeOfficialUrl(
              firstText(raw, ['detailUrl', 'sourceUrl', 'url']) ?? entryUrl,
              definition.hosts,
            );
            yield { type: 'job', job: { externalJobId: id, sourceUrl, raw } };
          }
          yield { type: 'page', page: collectedPage.page, discoveredCount };
        }
        if (expectedCount !== null && discoveredCount !== expectedCount) coverage = 'partial';
        yield {
          type: 'complete',
          coverage,
          cursor: null,
          pages: collection.pages.length,
          discoveredCount,
        };
        return;
      }
      checkRuntimeToken(context.config);
      const seen = new Set<string>();
      let page = 1;
      let total = 0;
      let discoveredCount = 0;
      let coverage: 'complete' | 'partial' = 'complete';

      for (;;) {
        if (context.signal.aborted)
          throw new SourceError('temporary', 'Scripted source discovery was aborted.');
        const response = await context.http.request({
          ...request({
            config: context.config,
            page,
            requestId: context.requestId,
            signal: context.signal,
            timeoutMs: context.timeoutMs,
          }),
          responseType: 'json',
        });
        const parsed = parsePage(response.body, context.config.pageSize);
        if (page === 1) total = parsed.total;
        if (parsed.total !== total || parsed.items.length > context.config.pageSize)
          coverage = 'partial';
        for (const value of parsed.items) {
          const raw = parseRecord(value);
          const id = externalId(raw);
          if (!id)
            throw new SourceError(
              'parse_changed',
              `${definition.company.name} returned a job without a stable ID.`,
            );
          if (seen.has(id)) {
            coverage = 'partial';
            continue;
          }
          seen.add(id);
          discoveredCount += 1;
          yield { type: 'job', job: { externalJobId: id, sourceUrl: entryUrl, raw } };
        }
        yield { type: 'page', page, discoveredCount };
        if (discoveredCount >= total || parsed.items.length === 0) break;
        if (parsed.items.length < context.config.pageSize) {
          coverage = 'partial';
          break;
        }
        page += 1;
      }
      if (discoveredCount !== total) coverage = 'partial';
      yield { type: 'complete', coverage, cursor: null, pages: page, discoveredCount };
    },
    normalize(input, context) {
      return Promise.resolve().then(() => {
        const raw = parseRecord(input.discovered.raw);
        const id = externalId(raw);
        const jobTitle = title(raw);
        const jobDescription = description(raw);
        if (!id || !jobTitle || !jobDescription) {
          throw new SourceError(
            'parse_changed',
            `${definition.company.name} job schema no longer contains required fields.`,
          );
        }
        const timestamp = publishedAt(raw);
        const officialJobUrl = canonicalizeOfficialUrl(
          input.discovered.sourceUrl,
          definition.hosts,
        );
        const taxonomy = normalizeJobTaxonomy(
          firstText(raw, ['jobFamily', 'jobDirection', 'jobCategory', 'jobType']),
        );
        const recruitmentCategory = recruitmentCategoryFor(raw, definition.recruitmentType);
        return {
          job: parseNormalizedJob({
            companyId: context.companyId,
            sourceId: context.sourceId,
            externalJobId: id,
            title: jobTitle,
            department: firstText(raw, ['department', 'positionDept', 'positionDeptName']),
            jobFamily: taxonomy.jobFamily,
            jobSubfamily: taxonomy.jobSubfamily,
            recruitmentCategory,
            locations: locations(raw),
            employmentType:
              firstText(raw, ['employmentType', 'recruitTypeName']) ??
              (recruitmentCategory === 'internship'
                ? '实习'
                : recruitmentCategory === 'campus'
                  ? '校招'
                  : recruitmentCategory === 'social'
                    ? '全职'
                    : null),
            experienceText: firstText(raw, ['experience', 'workYears']),
            educationText: firstText(raw, ['education', 'degree']),
            description: jobDescription,
            detailUrl: officialJobUrl,
            applyUrl: officialJobUrl,
            publishedAt: timestamp === null ? null : utcInstant(timestamp),
          }),
          provenance: {
            title: '$.title|$.name|$.positionName|$.positionNameOpen',
            description: '$.description|$.jobDuty|$.workContent|$.qualification',
            locations: '$.location|$.workLocation|$.workCity',
          },
          sourcePrivateJson: { raw },
        };
      });
    },
    async healthCheck(context): Promise<SourceHealth> {
      const startedAt = Date.now();
      try {
        if (definition.transport === 'browser') {
          if (!context.page?.collect) {
            throw new SourceError(
              'access_blocked',
              `${definition.company.name} requires a normal browser collection session.`,
            );
          }
          const collection = await context.page.collect(browserRequest(definition, context));
          const count = collection.pages.reduce((total, page) => total + page.records.length, 0);
          const ok = count > 0 && collection.coverage === 'complete';
          return {
            status: ok ? 'healthy' : 'degraded',
            checkedAt: Date.now(),
            latencyMs: Date.now() - startedAt,
            signals: [
              {
                key: 'browser_rendered_list',
                ok,
                diagnostic: ok ? null : 'Browser collection was not complete.',
              },
            ],
            errorCategory: null,
          };
        }
        checkRuntimeToken(context.config);
        const response = await context.http.request({
          ...request({
            config: { ...context.config, pageSize: 1 },
            page: 1,
            requestId: context.requestId,
            signal: context.signal,
            timeoutMs: context.timeoutMs,
          }),
          responseType: 'json',
        });
        const parsed = parsePage(response.body, 1);
        const ok = parsed.items.length > 0;
        return {
          status: ok ? 'healthy' : 'degraded',
          checkedAt: Date.now(),
          latencyMs: Date.now() - startedAt,
          signals: [
            {
              key: 'anonymous_scripted_list',
              ok,
              diagnostic: ok ? null : 'Official source returned no jobs.',
            },
          ],
          errorCategory: null,
        };
      } catch (error) {
        const sourceError = requestFailure(
          error,
          `${definition.company.name} list response schema changed.`,
        );
        return {
          status: sourceError.category === 'temporary' ? 'degraded' : 'unhealthy',
          checkedAt: Date.now(),
          latencyMs: Date.now() - startedAt,
          signals: [
            { key: 'anonymous_scripted_list', ok: false, diagnostic: sourceError.safeDiagnostic },
          ],
          errorCategory: sourceError.category,
        };
      }
    },
  };
}

export function appendQuery(
  url: string,
  entries: Readonly<Record<string, string | number | undefined>>,
): string {
  const target = new URL(url);
  for (const [key, value] of Object.entries(entries)) {
    if (value !== undefined) target.searchParams.set(key, String(value));
  }
  return target.toString();
}

export function jsonRequest(input: {
  readonly sourceKey: string;
  readonly requestId: string;
  readonly url: string;
  readonly hosts: readonly string[];
  readonly signal: AbortSignal;
  readonly body: unknown;
  readonly headers?: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
}): SourceHttpRequest {
  return {
    sourceKey: input.sourceKey,
    requestId: input.requestId,
    url: input.url,
    allowedHosts: input.hosts,
    signal: input.signal,
    method: 'POST',
    headers: { 'content-type': 'application/json', ...input.headers },
    body: JSON.stringify(input.body),
    responseType: 'json',
    timeoutMs: input.timeoutMs,
  };
}
