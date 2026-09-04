import type { UtcInstant } from '@jobhunter/domain';

/** 职位理解功能开关的设置键。 */
export const JOB_UNDERSTANDING_SETTING_KEY = 'matching.jobUnderstanding' as const;
/** 当前来源同步渠道的设置键。 */
export const SOURCE_SYNC_CHANNEL_SETTING_KEY = 'sources.activeChannel' as const;

/** 应用层使用的类型约束。 */
export type SourceSyncChannel = 'intern' | 'campus' | 'social';
export type ApplicationSettingKey =
  typeof JOB_UNDERSTANDING_SETTING_KEY | typeof SOURCE_SYNC_CHANNEL_SETTING_KEY;

/** 应用层数据结构或端口契约。 */
export interface ApplicationSettingsRepository {
  get(key: ApplicationSettingKey): unknown;
  set(key: ApplicationSettingKey, value: unknown, updatedAt: UtcInstant): void;
  setSourceSyncChannel(channel: SourceSyncChannel, updatedAt: UtcInstant): void;
}
