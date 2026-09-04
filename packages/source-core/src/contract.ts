import type { CompanyId, JobSourceId, NormalizedJob } from '@jobhunter/domain';
import { z } from 'zod';
import type { SourceErrorCategory } from './errors.js';
import type { SourceHttpClient } from './http-client.js';

/** Browser-backed implementations expose only a neutral snapshot, never Playwright objects. */
/** 来源适配器使用的类型约束。 */
export type SourcePageCollectionResponseShape =
  | 'ats-job-posts'
  | 'alibaba-campus'
  | 'huawei-campus'
  | 'meituan-jobs'
  | 'qihoo360-jobs'
  | 'xiaomi-jobs'
  | 'netease-jobs';

/** 来源适配器使用的数据结构或契约。 */
export interface SourcePageCollectionRequest {
  readonly sourceKey: string;
  readonly requestId: string;
  readonly url: string;
  readonly allowedHosts: readonly string[];
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
  /** Whole-collection timeout; independent from a single navigation or JSON request timeout. */
  readonly operationTimeoutMs?: number;
  readonly maximumPages: number;
  readonly maximumResponseBytes: number;
  /** Adapter-configured JSON page capacity used after the browser initializes the session. */
  readonly pageSize?: number;
  /** Official list endpoint path observed from the rendered page session. */
  readonly listEndpointPath: string;
  readonly responseShape: SourcePageCollectionResponseShape;
}

/** 来源适配器使用的数据结构或契约。 */
export interface SourcePageCollectionPage {
  readonly page: number;
  readonly url: string;
  readonly records: readonly Record<string, unknown>[];
  readonly total: number | null;
  readonly capturedAt: number;
}

/** 来源适配器使用的数据结构或契约。 */
export interface SourcePageCollection {
  readonly pages: readonly SourcePageCollectionPage[];
  readonly coverage: 'complete' | 'partial' | 'unknown';
  readonly diagnostics?: DiscoveryDiagnostics;
}

/** 来源适配器使用的数据结构或契约。 */
export interface SourcePageClient {
  snapshot(request: {
    readonly sourceKey: string;
    readonly requestId: string;
    readonly url: string;
    readonly allowedHosts: readonly string[];
    readonly signal: AbortSignal;
    readonly timeoutMs: number;
    readonly maximumResponseBytes: number;
  }): Promise<{ readonly url: string; readonly html: string; readonly capturedAt: number }>;
  /**
   * Optional same-session structured collection. The implementation owns page
   * navigation and normal browser execution; it returns records only.
   */
  readonly collect?: (request: SourcePageCollectionRequest) => Promise<SourcePageCollection>;
}

/** 来源适配器元数据 Schema。 */
export const sourceMetadataSchema = z
  .object({
    key: z
      .string()
      .min(1)
      .regex(/^[a-z0-9][a-z0-9._-]*$/),
    version: z.string().min(1),
    company: z.object({ slug: z.string().min(1), name: z.string().min(1) }).strict(),
    recruitmentType: z.enum(['social', 'campus', 'mixed']),
    canonicalEntryUrl: z.url({ protocol: /^https$/ }),
    officialHosts: z.array(z.string().min(1)).min(1),
    capabilities: z
      .object({
        detail: z.enum(['inline', 'deferred']),
        pagination: z.enum(['none', 'page', 'cursor']),
        transport: z.enum(['json', 'embedded_json', 'html', 'browser']),
      })
      .strict(),
    defaultRateLimit: z
      .object({ requestsPerMinute: z.number().positive(), burst: z.number().int().positive() })
      .strict(),
    externalIdFingerprintVersion: z.string().min(1).nullable(),
  })
  .strict();

/** 来源适配器使用的类型约束。 */
export type SourceMetadata = z.infer<typeof sourceMetadataSchema>;

/** 来源发现职位的最小结构。 */
export const discoveredJobSchema = z
  .object({
    externalJobId: z.string().min(1),
    sourceUrl: z.url({ protocol: /^https$/ }),
    raw: z.unknown(),
  })
  .strict();

/** 来源适配器使用的类型约束。 */
export type DiscoveredJob = z.infer<typeof discoveredJobSchema>;

/** 来源适配器使用的类型约束。 */
export type DiscoveryCoverage = 'complete' | 'partial' | 'unknown';

/** 来源适配器使用的数据结构或契约。 */
export interface DiscoveryDiagnostics {
  readonly reason: string | null;
  readonly retryable: boolean;
  readonly expectedCount?: number | null;
  readonly discoveredCount?: number;
  readonly expectedPages?: number | null;
  readonly fetchedPages?: number;
  readonly duplicateIds?: number;
  readonly totalChanged?: boolean;
}

/** 来源适配器使用的类型约束。 */
export type DiscoveryEvent =
  | { readonly type: 'job'; readonly job: DiscoveredJob }
  | {
      readonly type: 'page';
      readonly page: number;
      readonly discoveredCount: number;
    }
  | {
      readonly type: 'complete';
      readonly coverage: DiscoveryCoverage;
      readonly cursor: unknown;
      readonly pages: number;
      readonly discoveredCount: number;
      readonly diagnostics?: DiscoveryDiagnostics;
    };

/** 来源适配器使用的数据结构或契约。 */
export interface SourceRequestContext<TConfig> {
  readonly sourceId: JobSourceId;
  readonly companyId: CompanyId;
  readonly requestId: string;
  readonly config: TConfig;
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
  readonly http: SourceHttpClient;
  readonly page?: SourcePageClient;
}

/** 来源适配器使用的数据结构或契约。 */
export interface DiscoverContext<TConfig> extends SourceRequestContext<TConfig> {
  readonly cursor: unknown;
}

/** 来源适配器使用的数据结构或契约。 */
export interface RawJobInput<TDetail = unknown> {
  readonly discovered: DiscoveredJob;
  readonly detail: TDetail | null;
}

/** 来源适配器使用的数据结构或契约。 */
export interface NormalizedSourceJob {
  readonly job: NormalizedJob;
  readonly provenance: Readonly<Record<string, string>>;
  readonly sourcePrivateJson: Readonly<Record<string, unknown>>;
}

/** 来源探活结果 Schema。 */
export const sourceHealthSchema = z
  .object({
    status: z.enum(['healthy', 'degraded', 'unhealthy']),
    checkedAt: z.number().int().nonnegative(),
    latencyMs: z.number().int().nonnegative(),
    signals: z.array(
      z
        .object({
          key: z.string().min(1),
          ok: z.boolean(),
          diagnostic: z.string().max(240).nullable(),
        })
        .strict(),
    ),
    errorCategory: z
      .enum([
        'temporary',
        'rate_limited',
        'not_found',
        'access_blocked',
        'parse_changed',
        'invalid_config',
      ] satisfies readonly SourceErrorCategory[])
      .nullable(),
  })
  .strict();

/** 来源适配器使用的类型约束。 */
export type SourceHealth = z.infer<typeof sourceHealthSchema>;

/** 来源适配器使用的数据结构或契约。 */
export interface JobSourceAdapter<TConfig = unknown, TDetail = unknown> {
  readonly metadata: SourceMetadata;
  readonly configSchema: z.ZodType<TConfig>;
  discover(context: DiscoverContext<TConfig>): AsyncIterable<DiscoveryEvent>;
  fetchDetail?: (job: DiscoveredJob, context: SourceRequestContext<TConfig>) => Promise<TDetail>;
  normalize(
    input: RawJobInput<TDetail>,
    context: Pick<SourceRequestContext<TConfig>, 'sourceId' | 'companyId' | 'config'>,
  ): Promise<NormalizedSourceJob>;
  healthCheck(context: SourceRequestContext<TConfig>): Promise<SourceHealth>;
}
