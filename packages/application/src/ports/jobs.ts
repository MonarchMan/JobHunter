import type {
  ContentHash,
  JobId,
  JobRevisionId,
  JobLifecycleSnapshot,
  JobMergeDecision,
  JobStatus,
  NormalizedJob,
  RevisionNumber,
  SourceJobIdentity,
  SyncRunId,
  UtcInstant,
} from '@jobhunter/domain';

/** 应用层数据结构或端口契约。 */
export interface PersistJobMutation {
  readonly decision: Exclude<JobMergeDecision, { readonly type: 'unchanged' }>;
  readonly jobId: JobId;
  readonly revisionId: string;
  readonly statusEventId: string;
  readonly sourcePayloadHash: ContentHash;
  readonly sourceUrl: string;
  readonly normalizerVersion: string;
  readonly syncRunId: SyncRunId;
  readonly observedAt: UtcInstant;
}

/** 应用层数据结构或端口契约。 */
export interface PersistJobStatus {
  readonly jobId: JobId;
  readonly lifecycle: JobLifecycleSnapshot;
  readonly syncRunId: SyncRunId | null;
  readonly eventId: string | null;
  readonly fromStatus: JobStatus | null;
  readonly reason: string | null;
  readonly occurredAt: UtcInstant;
  readonly evidence?: unknown;
}

/** 应用层数据结构或端口契约。 */
export interface CurrentJobRecord {
  readonly jobId: JobId;
  readonly revisionId: JobRevisionId;
  readonly identity: SourceJobIdentity;
  readonly revisionNumber: RevisionNumber;
  readonly contentHash: ContentHash;
  readonly normalized: NormalizedJob;
  readonly lifecycle: JobLifecycleSnapshot;
}

/** 应用层数据结构或端口契约。 */
export interface JobRepository {
  findCurrent(identity: SourceJobIdentity): CurrentJobRecord | null;
  persistMutation(input: PersistJobMutation): void;
  persistDetailRevision(input: {
    readonly decision: Extract<JobMergeDecision, { readonly type: 'revise' }>;
    readonly revisionId: string;
    readonly sourcePayloadHash: ContentHash;
    readonly sourceUrl: string;
    readonly normalizerVersion: string;
    readonly occurredAt: UtcInstant;
  }): void;
  recordObservation(input: {
    readonly jobId: JobId;
    readonly syncRunId: SyncRunId;
    readonly jobRevisionId: JobRevisionId;
    readonly observedAt: UtcInstant;
  }): void;
  persistStatus(input: PersistJobStatus): void;
}
