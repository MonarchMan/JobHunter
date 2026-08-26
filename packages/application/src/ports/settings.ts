import type { UtcInstant } from '@jobhunter/domain';

export const JOB_UNDERSTANDING_SETTING_KEY = 'matching.jobUnderstanding' as const;

export interface ApplicationSettingsRepository {
  get(key: typeof JOB_UNDERSTANDING_SETTING_KEY): unknown;
  set(key: typeof JOB_UNDERSTANDING_SETTING_KEY, value: unknown, updatedAt: UtcInstant): void;
}
