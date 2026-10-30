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
    const kuaishouInternSources = [
      ...sources.filter((source) => source.adapterKey === 'kuaishou.intern'),
      ...sources.filter((source) => source.adapterKey === 'kuaishou.intern.campus'),
    ];
    const hasAggregatePair = kuaishouInternSources.length === 2;
    const canAggregate =
      hasAggregatePair && kuaishouInternSources.every((source) => source.effectiveEnabled);
    for (const source of sources) {
      const isGroupedInternSource =
        hasAggregatePair &&
        (source.adapterKey === 'kuaishou.intern' || source.adapterKey === 'kuaishou.intern.campus');
      if (isGroupedInternSource) {
        // 1.a、停用两个旧单来源计划，防止同日再各自产生一条任务。
        this.#schedules.upsert({
          id: source.id,
          scheduleKey: `source.sync:${source.id}`,
          taskType: 'source.sync',
          payload: { sourceId: source.id, trigger: 'schedule' },
          cronExpression,
          timezone: 'Asia/Shanghai',
          enabled: false,
        });
        continue;
      }
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
    if (hasAggregatePair) {
      // 2、用稳定分组键登记单条快手实习定时任务，主站失败也由处理器继续校园来源。
      const [primary, campus] = kuaishouInternSources;
      if (!primary || !campus) throw new TypeError('Kuaishou intern sources are incomplete.');
      const scheduleEnabled =
        canAggregate &&
        automation.enabled &&
        ready &&
        primary.channel === activeChannel &&
        campus.channel === activeChannel;
      // 2、复用主站旧计划 ID，仅改其 key 和 payload，保留另一个旧计划为停用记录。
      this.#schedules.upsert({
        id: primary.id,
        scheduleKey: `source.sync:${primary.id}`,
        taskType: 'source.sync',
        payload: {
          sourceIds: [primary.id, campus.id],
          trigger: 'schedule',
        },
        cronExpression,
        timezone: 'Asia/Shanghai',
        enabled: scheduleEnabled,
      });
      if (scheduleEnabled) enabled += 1;
    }
    return { total: sources.length, enabled };
  }
}
