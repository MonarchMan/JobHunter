import type { Clock } from '@jobhunter/domain';
import { z } from 'zod';
import {
  JOB_UNDERSTANDING_SETTING_KEY,
  type ApplicationSettingsRepository,
} from '../ports/settings.js';

export const jobUnderstandingSettingSchema = z.object({ enabled: z.boolean() }).strict();

export type JobUnderstandingSetting = z.infer<typeof jobUnderstandingSettingSchema>;

export interface SystemSettings {
  readonly jobUnderstanding: JobUnderstandingSetting;
}

export interface SystemSettingsMutation {
  readonly jobUnderstandingEnabled: boolean;
}

const defaultJobUnderstandingSetting: JobUnderstandingSetting = { enabled: false };

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
    return {
      jobUnderstanding:
        stored === null
          ? defaultJobUnderstandingSetting
          : jobUnderstandingSettingSchema.parse(stored),
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
    return this.get();
  }
}
