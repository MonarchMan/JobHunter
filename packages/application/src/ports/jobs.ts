import type {
  ContentHash,
  JobId,
  JobLifecycleSnapshot,
  JobMergeDecision,
  JobStatus,
  NormalizedJob,
  RevisionNumber,
  SourceJobIdentity,
  SyncRunId,
  UtcInstant,
} from '@jobhunter/domain';

export interface PersistJobMutation {
  readonly decision: Exclude<JobMergeDecision, { readonly type: 'unchanged' }>;
  readonly jobId: JobId;
  readonly revisionId: string;
  readonly statusEventId: string;
  readonly rawRecordId: string;
  readonly normalizerVersion: string;
  readonly syncRunId: SyncRunId;
  readonly observedAt: UtcInstant;
}

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

export interface CurrentJobRecord {
  readonly jobId: JobId;
  readonly identity: SourceJobIdentity;
  readonly revisionNumber: RevisionNumber;
  readonly contentHash: ContentHash;
  readonly normalized: NormalizedJob;
  readonly lifecycle: JobLifecycleSnapshot;
}

export interface JobRepository {
  findCurrent(identity: SourceJobIdentity): CurrentJobRecord | null;
  persistMutation(input: PersistJobMutation): void;
  persistDetailRevision(input: {
    readonly decision: Extract<JobMergeDecision, { readonly type: 'revise' }>;
    readonly revisionId: string;
    readonly rawRecordId: string;
    readonly normalizerVersion: string;
    readonly occurredAt: UtcInstant;
  }): void;
  recordObservation(input: {
    readonly jobId: JobId;
    readonly syncRunId: SyncRunId;
    readonly rawRecordId: string;
    readonly observedAt: UtcInstant;
  }): void;
  persistStatus(input: PersistJobStatus): void;
}
