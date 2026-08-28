import type { CompanyId, JobSourceId, SourceChannelId, UtcInstant } from '@jobhunter/domain';
import type { SourceSyncChannel } from './settings.js';

export interface SourceOverview {
  readonly id: JobSourceId;
  readonly companyId: CompanyId;
  readonly channelId: SourceChannelId;
  readonly channel: SourceSyncChannel;
  readonly companyName: string;
  readonly slug: string;
  readonly adapterKey: string;
  readonly coverageRole: 'required' | 'supplemental';
  readonly enabled: boolean;
  readonly effectiveEnabled: boolean;
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

export interface SourceChannelOverview {
  readonly id: SourceChannelId;
  readonly companyId: CompanyId;
  readonly companyName: string;
  readonly slug: string;
  readonly channel: 'intern' | 'campus' | 'social';
  readonly enabled: boolean;
  readonly effectiveEnabled: boolean;
  readonly supportNote: string | null;
  readonly supportStatus: 'experimental' | 'supported' | 'blocked';
  readonly healthStatus: 'unknown' | 'healthy' | 'degraded' | 'unhealthy';
  readonly sources: readonly SourceOverview[];
}

export interface SourceManagementRepository {
  list(): readonly SourceOverview[];
  get(id: JobSourceId): SourceOverview | null;
  listChannels(): readonly SourceChannelOverview[];
  getChannel(id: SourceChannelId): SourceChannelOverview | null;
}
