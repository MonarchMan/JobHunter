import type { IdGenerator, JobSourceId, SourceChannelId } from '@jobhunter/domain';
import type {
  SourceChannelOverview,
  SourceManagementRepository,
  SourceOverview,
} from '../ports/source-management.js';
import type { EnqueueTaskResult, TaskRecord } from '../tasks/model.js';
import type { TaskService } from '../tasks/task-service.js';
import type { JobIntakePolicy } from './job-intake-policy.js';
import type { SourceSyncChannel } from '../ports/settings.js';

export class SourceSyncTargetRequiredError extends TypeError {
  public constructor() {
    super('请先在个人资料中确认目标岗位，再同步职位。');
    this.name = 'SourceSyncTargetRequiredError';
  }
}

export class SourceManagementService {
  readonly #sources: SourceManagementRepository;
  readonly #tasks: TaskService;
  readonly #ids: IdGenerator;
  readonly #jobIntakePolicy: JobIntakePolicy;
  readonly #activeChannel: () => SourceSyncChannel;

  public constructor(input: {
    readonly sources: SourceManagementRepository;
    readonly tasks: TaskService;
    readonly ids: IdGenerator;
    readonly jobIntakePolicy: JobIntakePolicy;
    readonly activeChannel?: () => SourceSyncChannel;
  }) {
    this.#sources = input.sources;
    this.#tasks = input.tasks;
    this.#ids = input.ids;
    this.#jobIntakePolicy = input.jobIntakePolicy;
    this.#activeChannel = input.activeChannel ?? (() => 'intern');
  }

  public isSyncReady(): boolean {
    return this.#jobIntakePolicy.isReady();
  }

  public requireSyncReady(): void {
    if (!this.isSyncReady()) throw new SourceSyncTargetRequiredError();
  }

  public activeChannel(): SourceSyncChannel {
    return this.#activeChannel();
  }

  public list(): readonly SourceOverview[] {
    return this.#sources.list();
  }

  public get(id: JobSourceId): SourceOverview | null {
    return this.#sources.get(id);
  }

  public listChannels(): readonly SourceChannelOverview[] {
    return this.#sources.listChannels();
  }

  public getChannel(id: SourceChannelId): SourceChannelOverview | null {
    return this.#sources.getChannel(id);
  }

  public enqueueChannelSync(input: {
    readonly channelIds: readonly SourceChannelId[] | 'all';
    readonly idempotencyToken?: string;
  }): readonly EnqueueTaskResult[] {
    this.requireSyncReady();
    const channels =
      input.channelIds === 'all'
        ? this.#sources
            .listChannels()
            .filter(
              (channel) => channel.effectiveEnabled && channel.channel === this.activeChannel(),
            )
        : input.channelIds.map((id) => {
            const channel = this.#sources.getChannel(id);
            if (!channel) throw new TypeError(`Source channel not found: ${id}`);
            if (channel.channel !== this.activeChannel()) {
              throw new TypeError('该渠道不是当前选择的同步招聘渠道。');
            }
            if (!channel.effectiveEnabled) throw new TypeError(`Source channel is disabled: ${id}`);
            return channel;
          });
    const sourceIds = Array.from(
      new Set(
        channels.flatMap((channel) =>
          channel.sources.filter((source) => source.effectiveEnabled).map((source) => source.id),
        ),
      ),
    );
    return this.#enqueue(sourceIds, input.idempotencyToken);
  }

  public enqueueSync(input: {
    readonly sourceIds: readonly JobSourceId[] | 'all';
    readonly idempotencyToken?: string;
  }): readonly EnqueueTaskResult[] {
    this.requireSyncReady();
    const selected =
      input.sourceIds === 'all'
        ? this.#sources.list().filter((source) => source.effectiveEnabled)
        : input.sourceIds.map((id) => {
            const source = this.#sources.get(id);
            if (!source) throw new TypeError(`Source not found: ${id}`);
            if (source.channel !== this.activeChannel()) {
              throw new TypeError('该来源不属于当前选择的同步招聘渠道。');
            }
            if (!source.effectiveEnabled) throw new TypeError(`Source is disabled: ${id}`);
            return source;
          });
    return this.#enqueue(
      selected.map((source) => source.id),
      input.idempotencyToken,
    );
  }

  #enqueue(
    sourceIds: readonly JobSourceId[],
    idempotencyToken: string | undefined,
  ): readonly EnqueueTaskResult[] {
    const suppliedToken = idempotencyToken?.trim();
    const token = suppliedToken && suppliedToken.length > 0 ? suppliedToken : this.#ids.generate();
    return sourceIds.map((sourceId) =>
      this.#tasks.enqueue({
        taskType: 'source.sync',
        payload: { sourceId, trigger: 'manual' },
        idempotencyKey: `source.sync:${sourceId}:manual:${token}`,
      }),
    );
  }
}

export interface TaskWaitDelay {
  wait(milliseconds: number, signal: AbortSignal): Promise<void>;
}

export class TaskWaitService {
  readonly #tasks: Pick<TaskService, 'get'>;
  readonly #delay: TaskWaitDelay;

  public constructor(tasks: Pick<TaskService, 'get'>, delay: TaskWaitDelay) {
    this.#tasks = tasks;
    this.#delay = delay;
  }

  public async wait(taskId: TaskRecord['id'], signal: AbortSignal): Promise<TaskRecord | null> {
    let interval = 250;
    for (;;) {
      signal.throwIfAborted();
      const task = this.#tasks.get(taskId);
      if (!task || ['succeeded', 'failed', 'cancelled'].includes(task.status)) return task;
      await this.#delay.wait(interval, signal);
      interval = Math.min(2_000, Math.ceil(interval * 1.5));
    }
  }
}
