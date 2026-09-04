import type { JobSourceId, SyncRunId, UtcInstant } from '../shared/index.js';

/** 同步结果覆盖度。 */
export const SYNC_COVERAGES = ['complete', 'partial', 'unknown'] as const;
export type SyncCoverage = (typeof SYNC_COVERAGES)[number];

/** 同步运行生命周期状态。 */
export const SYNC_RUN_STATUSES = [
  'running',
  'succeeded',
  'partial',
  'failed',
  'cancelled',
] as const;
/** 领域模型的类型约束。 */
export type SyncRunStatus = (typeof SYNC_RUN_STATUSES)[number];

/** 来源支持等级。 */
export const SOURCE_SUPPORT_STATES = ['experimental', 'supported', 'blocked'] as const;
export type SourceSupportState = (typeof SOURCE_SUPPORT_STATES)[number];

/** 来源健康检查状态。 */
export const HEALTH_STATUSES = ['unknown', 'healthy', 'degraded', 'unhealthy'] as const;
export type HealthStatus = (typeof HEALTH_STATUSES)[number];

/** 模块数据结构或契约。 */
export interface SyncRunIdentity {
  readonly id: SyncRunId;
  readonly sourceId: JobSourceId;
  readonly startedAt: UtcInstant;
}
