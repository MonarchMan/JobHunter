import type { JobSourceId, UtcInstant } from '@jobhunter/domain';

export interface SourceOverview {
  readonly id: JobSourceId;
  readonly companyName: string;
  readonly slug: string;
  readonly adapterKey: string;
  readonly enabled: boolean;
  readonly supportStatus: 'experimental' | 'supported' | 'blocked';
  readonly healthStatus: 'unknown' | 'healthy' | 'degraded' | 'unhealthy';
  readonly lastRun: {
    readonly id: string;
    readonly status: 'running' | 'succeeded' | 'partial' | 'failed' | 'cancelled';
    readonly coverage: 'complete' | 'partial' | 'unknown';
    readonly startedAt: UtcInstant;
    readonly finishedAt: UtcInstant | null;
  } | null;
}

export interface SourceManagementRepository {
  list(): readonly SourceOverview[];
  get(id: JobSourceId): SourceOverview | null;
}
