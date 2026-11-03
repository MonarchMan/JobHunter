import type { UtcInstant } from '@jobhunter/common/domain';
import type { SourceSyncChannel } from '@jobhunter/recruitment/ports/source-management';
export type { SourceSyncChannel } from '@jobhunter/recruitment/ports/source-management';

/** 职位理解功能开关的设置键。 */
export const JOB_UNDERSTANDING_SETTING_KEY = 'matching.jobUnderstanding' as const;
/** 当前来源同步渠道的设置键。 */
export const SOURCE_SYNC_CHANNEL_SETTING_KEY = 'sources.activeChannel' as const;
/** 自动同步计划的设置键。 */
export const SOURCE_AUTOMATION_SETTING_KEY = 'sources.automation' as const;
/** 独立来源同步计划，随全局同步计划变化清空。 */
export const SOURCE_SCHEDULE_OVERRIDES_KEY = 'sources.scheduleOverrides' as const;
/** 自动匹配行为的设置键。 */
export const MATCHING_AUTOMATION_SETTING_KEY = 'matching.automation' as const;
/** 职位列表默认视图的设置键。 */
export const JOB_LIST_PREFERENCES_SETTING_KEY = 'ui.jobListPreferences' as const;

/** 应用层使用的类型约束。 */
export type ApplicationSettingKey =
  | typeof SOURCE_SCHEDULE_OVERRIDES_KEY
  | typeof JOB_UNDERSTANDING_SETTING_KEY
  | typeof SOURCE_SYNC_CHANNEL_SETTING_KEY
  | typeof SOURCE_AUTOMATION_SETTING_KEY
  | typeof MATCHING_AUTOMATION_SETTING_KEY
  | typeof JOB_LIST_PREFERENCES_SETTING_KEY;

/** 应用层数据结构或端口契约。 */
export interface ApplicationSettingsRepository {
  get(key: ApplicationSettingKey): unknown;
  set(key: ApplicationSettingKey, value: unknown, updatedAt: UtcInstant): void;
  setSourceSyncChannel(channel: SourceSyncChannel, updatedAt: UtcInstant): void;
}
