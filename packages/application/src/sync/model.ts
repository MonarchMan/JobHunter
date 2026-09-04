import type {
  CompanyId,
  ContentHash,
  JobSourceId,
  SyncRunId,
  TaskId,
  UtcInstant,
} from '@jobhunter/domain';
import type { CurrentJobRecord } from '../ports/jobs.js';

/** 应用层使用的类型约束。 */
export type SyncTrigger = 'manual' | 'schedule' | 'retry';
export type SyncRunStatus = 'running' | 'succeeded' | 'partial' | 'failed' | 'cancelled';
export type SyncCoverage = 'complete' | 'partial' | 'unknown';

/** 应用层使用的类型约束。 */
export interface SourceSyncPolicy {
  readonly staleAfterMisses: number;
  readonly closeAfterMisses: number;
  readonly degradedAfterFailures: number;
  readonly unhealthyAfterFailures: number;
  readonly enrichNewRevisions: boolean;
  readonly requestTimeoutMs: number;
}

/** 应用层数据结构或端口契约。 */
export interface SyncSourceRecord {
  readonly id: JobSourceId;
  readonly companyId: CompanyId;
  readonly adapterKey: string;
  readonly config: unknown;
  readonly syncPolicyVersion: string;
  readonly syncPolicy: SourceSyncPolicy;
  readonly enabled: boolean;
  readonly cursor: unknown;
  readonly consecutiveFailures: number;
}

/** 应用层数据结构或端口契约。 */
export interface SyncRunStats {
  readonly discovered: number;
  readonly created: number;
  readonly unchanged: number;
  readonly revised: number;
  readonly restored: number;
  readonly staled: number;
  readonly closed: number;
  readonly isolated: number;
  readonly skippedNonDomestic: number;
  readonly skippedUnknownRegion: number;
  readonly skippedOutOfScope: number;
  readonly followupEnqueued: number;
}

/** 应用层数据结构或端口契约。 */
export interface StartSyncRunInput {
  readonly id: SyncRunId;
  readonly sourceId: JobSourceId;
  readonly trigger: SyncTrigger;
  readonly coverage: SyncCoverage;
  readonly adapterVersion: string;
  readonly normalizerVersion: string;
  readonly syncPolicyVersion: string;
  readonly sourceConfigHash: string;
  readonly cursorIn: unknown;
  readonly startedAt: UtcInstant;
}

/** 应用层数据结构或端口契约。 */
export type StartSyncRunResult =
  | { readonly kind: 'started'; readonly runId: SyncRunId }
  | { readonly kind: 'conflict'; readonly runId: SyncRunId };

/** 应用层数据结构或端口契约。 */
export interface FinishSyncRunInput {
  readonly runId: SyncRunId;
  readonly sourceId: JobSourceId;
  readonly status: Exclude<SyncRunStatus, 'running'>;
  readonly coverage: SyncCoverage;
  readonly cursorOut: unknown;
  readonly stats: SyncRunStats;
  readonly errorCategory: string | null;
  readonly errorSummary: string | null;
  readonly finishedAt: UtcInstant;
  readonly sourceHealth: 'healthy' | 'degraded' | 'unhealthy';
  readonly consecutiveFailures: number;
  readonly coverageEvidence: unknown;
}

/** 执行应用层的解析、转换或编排辅助逻辑。 */
export interface CachedSourceJobDetail {
  readonly detail: unknown;
  readonly listContentHash: ContentHash;
  readonly adapterVersion: string;
}

/** 应用层数据结构或端口契约。 */
export interface SyncRepository {
  getSource(sourceId: JobSourceId): SyncSourceRecord | null;
  startRun(input: StartSyncRunInput): StartSyncRunResult;
  getCachedJobDetail(
    sourceId: JobSourceId,
    externalJobId: string,
    listContentHash: ContentHash,
    adapterVersion: string,
  ): CachedSourceJobDetail | null;
  recordJobDetailSuccess(input: {
    readonly sourceId: JobSourceId;
    readonly externalJobId: string;
    readonly listContentHash: ContentHash;
    readonly adapterVersion: string;
    readonly detail: unknown;
    readonly fetchedAt: UtcInstant;
  }): void;
  recordJobDetailFailure(input: {
    readonly sourceId: JobSourceId;
    readonly externalJobId: string;
    readonly listContentHash: ContentHash;
    readonly adapterVersion: string;
    readonly errorCategory: string;
    readonly errorSummary: string;
    readonly occurredAt: UtcInstant;
  }): void;
  recordItemFailure(input: {
    readonly id: string;
    readonly runId: SyncRunId;
    readonly sourceId: JobSourceId;
    readonly externalJobId: string;
    readonly stage: 'normalize' | 'identity';
    readonly errorCategory: string;
    readonly errorSummary: string;
    readonly sourceUrl: string;
    readonly occurredAt: UtcInstant;
  }): void;
  findUnseenJobs(
    sourceId: JobSourceId,
    runId: SyncRunId,
    limit: number,
  ): readonly CurrentJobRecord[];
  markMissingProcessed(runId: SyncRunId, jobId: CurrentJobRecord['jobId']): void;
  finishRun(input: FinishSyncRunInput): boolean;
  cleanupSeen(runId: SyncRunId): void;
}

/** 应用层数据结构或端口契约。 */
export interface DerivationTaskFactory {
  forRevision(input: { readonly revisionId: string }): readonly {
    readonly id: TaskId;
    readonly taskType: string;
    readonly payload: unknown;
    readonly idempotencyKey: string;
  }[];
}
