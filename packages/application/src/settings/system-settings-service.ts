import type { Clock } from '@jobhunter/domain';
import { z } from 'zod';
import {
  JOB_UNDERSTANDING_SETTING_KEY,
  SOURCE_SYNC_CHANNEL_SETTING_KEY,
  type ApplicationSettingsRepository,
  type SourceSyncChannel,
} from '../ports/settings.js';

/** 职位理解功能开关 Schema。 */
export const jobUnderstandingSettingSchema = z.object({ enabled: z.boolean() }).strict();

export type JobUnderstandingSetting = z.infer<typeof jobUnderstandingSettingSchema>;
/** 当前来源同步渠道 Schema。 */
export const sourceSyncSettingSchema = z
  .object({ channel: z.enum(['intern', 'campus', 'social']) })
  .strict();
export type SourceSyncSetting = z.infer<typeof sourceSyncSettingSchema>;

/** 应用层数据结构或端口契约。 */
export interface SystemSettings {
  readonly jobUnderstanding: JobUnderstandingSetting;
  readonly sourceSync: SourceSyncSetting;
}

/** 应用层数据结构或端口契约。 */
export interface SystemSettingsMutation {
  readonly jobUnderstandingEnabled: boolean;
  readonly sourceSyncChannel: SourceSyncChannel;
}

const defaultJobUnderstandingSetting: JobUnderstandingSetting = { enabled: false };
const defaultSourceSyncSetting: SourceSyncSetting = { channel: 'intern' };

/** 管理职位理解开关和来源同步渠道。 */
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

  /** 读取并解析当前系统设置。 */
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

  /** 执行应用组件对外暴露的操作。 */
  public isJobUnderstandingEnabled(): boolean {
    return this.get().jobUnderstanding.enabled;
  }

  /** 校验并写入设置变更。 */
  public update(mutation: SystemSettingsMutation): SystemSettings {
    // 1、读取现值；2、应用变更；3、写入设置；4、返回规范化结果。
    const value = jobUnderstandingSettingSchema.parse({
      enabled: mutation.jobUnderstandingEnabled,
    });
    this.#repository.set(JOB_UNDERSTANDING_SETTING_KEY, value, this.#clock.now());
    this.#repository.setSourceSyncChannel(mutation.sourceSyncChannel, this.#clock.now());
    return this.get();
  }

  /** 执行应用组件对外暴露的操作。 */
  public applySourceSyncChannelSelection(): SystemSettings {
    const settings = this.get();
    this.#repository.setSourceSyncChannel(settings.sourceSync.channel, this.#clock.now());
    return this.get();
  }
}
