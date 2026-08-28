import type { Clock } from '@jobhunter/domain';
import { z } from 'zod';
import {
  JOB_UNDERSTANDING_SETTING_KEY,
  SOURCE_SYNC_CHANNEL_SETTING_KEY,
  type ApplicationSettingsRepository,
  type SourceSyncChannel,
} from '../ports/settings.js';

export const jobUnderstandingSettingSchema = z.object({ enabled: z.boolean() }).strict();

export type JobUnderstandingSetting = z.infer<typeof jobUnderstandingSettingSchema>;
export const sourceSyncSettingSchema = z
  .object({ channel: z.enum(['intern', 'campus', 'social']) })
  .strict();
export type SourceSyncSetting = z.infer<typeof sourceSyncSettingSchema>;

export interface SystemSettings {
  readonly jobUnderstanding: JobUnderstandingSetting;
  readonly sourceSync: SourceSyncSetting;
}

export interface SystemSettingsMutation {
  readonly jobUnderstandingEnabled: boolean;
  readonly sourceSyncChannel: SourceSyncChannel;
}

const defaultJobUnderstandingSetting: JobUnderstandingSetting = { enabled: false };
const defaultSourceSyncSetting: SourceSyncSetting = { channel: 'intern' };

export class SystemSettingsService {
  readonly #repository: ApplicationSettingsRepository;
  readonly #clock: Clock;

  public constructor(input: {
    readonly repository: ApplicationSettingsRepository;
    readonly clock: Clock;
  }) {
    this.#repository = input.repository;
    this.#clock = input.clock;
  }

  public get(): SystemSettings {
    const stored = this.#repository.get(JOB_UNDERSTANDING_SETTING_KEY);
    const storedSourceSync = this.#repository.get(SOURCE_SYNC_CHANNEL_SETTING_KEY);
    return {
      jobUnderstanding:
        stored === null
          ? defaultJobUnderstandingSetting
          : jobUnderstandingSettingSchema.parse(stored),
      sourceSync:
        storedSourceSync === null
          ? defaultSourceSyncSetting
          : sourceSyncSettingSchema.parse(storedSourceSync),
    };
  }

  public isJobUnderstandingEnabled(): boolean {
    return this.get().jobUnderstanding.enabled;
  }

  public update(mutation: SystemSettingsMutation): SystemSettings {
    const value = jobUnderstandingSettingSchema.parse({
      enabled: mutation.jobUnderstandingEnabled,
    });
    this.#repository.set(JOB_UNDERSTANDING_SETTING_KEY, value, this.#clock.now());
    this.#repository.setSourceSyncChannel(mutation.sourceSyncChannel, this.#clock.now());
    return this.get();
  }

  public applySourceSyncChannelSelection(): SystemSettings {
    const settings = this.get();
    this.#repository.setSourceSyncChannel(settings.sourceSync.channel, this.#clock.now());
    return this.get();
  }
}
