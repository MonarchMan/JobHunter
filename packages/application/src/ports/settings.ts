import type { UtcInstant } from '@jobhunter/domain';

export const JOB_UNDERSTANDING_SETTING_KEY = 'matching.jobUnderstanding' as const;
export const SOURCE_SYNC_CHANNEL_SETTING_KEY = 'sources.activeChannel' as const;

export type SourceSyncChannel = 'intern' | 'campus' | 'social';
export type ApplicationSettingKey =
  typeof JOB_UNDERSTANDING_SETTING_KEY | typeof SOURCE_SYNC_CHANNEL_SETTING_KEY;

export interface ApplicationSettingsRepository {
  get(key: ApplicationSettingKey): unknown;
  set(key: ApplicationSettingKey, value: unknown, updatedAt: UtcInstant): void;
  setSourceSyncChannel(channel: SourceSyncChannel, updatedAt: UtcInstant): void;
}
