import type { SourceManagementRepository } from '../ports/source-management.js';
import type { SourceSyncChannel } from '../ports/settings.js';
import type { ScheduleService } from '../tasks/schedule-service.js';
import type { JobIntakePolicy } from './job-intake-policy.js';

export class SourceScheduleReconciliationService {
  readonly #sources: SourceManagementRepository;
  readonly #schedules: Pick<ScheduleService, 'upsert'>;
  readonly #jobIntakePolicy: JobIntakePolicy;
  readonly #activeChannel: () => SourceSyncChannel;

  public constructor(input: {
    readonly sources: SourceManagementRepository;
    readonly schedules: Pick<ScheduleService, 'upsert'>;
    readonly jobIntakePolicy: JobIntakePolicy;
    readonly activeChannel: () => SourceSyncChannel;
  }) {
    this.#sources = input.sources;
    this.#schedules = input.schedules;
    this.#jobIntakePolicy = input.jobIntakePolicy;
    this.#activeChannel = input.activeChannel;
  }

  public reconcile(): { readonly total: number; readonly enabled: number } {
    const ready = this.#jobIntakePolicy.isReady();
    const activeChannel = this.#activeChannel();
    let enabled = 0;
    const sources = this.#sources.list();
    for (const source of sources) {
      const scheduleEnabled =
        ready && source.channel === activeChannel && source.effectiveEnabled;
      this.#schedules.upsert({
        id: source.id,
        scheduleKey: `source.sync:${source.id}`,
        taskType: 'source.sync',
        payload: { sourceId: source.id, trigger: 'schedule' },
        cronExpression: '0 3 * * *',
        timezone: 'Asia/Shanghai',
        enabled: scheduleEnabled,
      });
      if (scheduleEnabled) enabled += 1;
    }
    return { total: sources.length, enabled };
  }
}
