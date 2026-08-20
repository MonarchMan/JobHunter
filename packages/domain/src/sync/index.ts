import type { JobSourceId, SyncRunId, UtcInstant } from '../shared/index.js';

export const SYNC_COVERAGES = ['complete', 'partial', 'unknown'] as const;
export type SyncCoverage = (typeof SYNC_COVERAGES)[number];

export const SYNC_RUN_STATUSES = [
  'running',
  'succeeded',
  'partial',
  'failed',
  'cancelled',
] as const;
export type SyncRunStatus = (typeof SYNC_RUN_STATUSES)[number];

export const SOURCE_SUPPORT_STATES = ['experimental', 'supported', 'blocked'] as const;
export type SourceSupportState = (typeof SOURCE_SUPPORT_STATES)[number];

export const HEALTH_STATUSES = ['unknown', 'healthy', 'degraded', 'unhealthy'] as const;
export type HealthStatus = (typeof HEALTH_STATUSES)[number];

export interface SyncRunIdentity {
  readonly id: SyncRunId;
  readonly sourceId: JobSourceId;
  readonly startedAt: UtcInstant;
}
