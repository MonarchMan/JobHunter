import type { SourceManagementRepository } from '../ports/source-management.js';
import type { SourceSyncChannel } from '../ports/settings.js';
import type { SystemSettings } from '../settings/system-settings-service.js';
import type { ScheduleService } from '../tasks/schedule-service.js';
import type { JobIntakePolicy } from './job-intake-policy.js';

/** 根据来源启用状态对通用 schedules 进行幂等对账。 */
export class SourceScheduleReconciliationService {
  readonly #sources: SourceManagementRepository;
  readonly #schedules: Pick<ScheduleService, 'upsert'>;
  readonly #jobIntakePolicy: JobIntakePolicy;
  readonly #activeChannel: () => SourceSyncChannel;
  readonly #automation: () => SystemSettings['sourceAutomation'];

  /** 执行应用组件对外暴露的操作。 */
  public constructor(input: {
    readonly sources: SourceManagementRepository;
    readonly schedules: Pick<ScheduleService, 'upsert'>;
    readonly jobIntakePolicy: JobIntakePolicy;
    readonly activeChannel: () => SourceSyncChannel;
    readonly automation: () => SystemSettings['sourceAutomation'];
  }) {
    this.#sources = input.sources;
    this.#schedules = input.schedules;
    this.#jobIntakePolicy = input.jobIntakePolicy;
    this.#activeChannel = input.activeChannel;
    this.#automation = input.automation;
  }

  /** 创建、更新或停用来源调度，并返回统计。 */
  public reconcile(): { readonly total: number; readonly enabled: number } {
    const ready = this.#jobIntakePolicy.isReady();
    const activeChannel = this.#activeChannel();
    const automation = this.#automation();
    const [hour, minute] = automation.time.split(':').map(Number);
    const cronExpression = `${String(minute)} ${String(hour)} * * ${automation.frequency === 'weekly' ? '1' : '*'}`;
    let enabled = 0;
    const sources = this.#sources.list();
    for (const source of sources) {
      const scheduleEnabled =
        automation.enabled && ready && source.channel === activeChannel && source.effectiveEnabled;
      this.#schedules.upsert({
        id: source.id,
        scheduleKey: `source.sync:${source.id}`,
        taskType: 'source.sync',
        payload: { sourceId: source.id, trigger: 'schedule' },
        cronExpression,
        timezone: 'Asia/Shanghai',
        enabled: scheduleEnabled,
      });
      if (scheduleEnabled) enabled += 1;
    }
    return { total: sources.length, enabled };
  }
}
