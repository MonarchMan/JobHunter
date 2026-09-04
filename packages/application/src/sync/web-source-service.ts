import {
  parseId,
  type IdGenerator,
  type JobSourceId,
  type SourceChannelId,
} from '@jobhunter/domain';
import {
  webSourceChannelMutationSchema,
  webSourceChannelSchema,
  webSourceMutationSchema,
  webSourceSchema,
  webTaskAcceptedSchema,
  type WebSource,
  type WebSourceChannel,
  type WebSourceChannelMutation,
  type WebSourceMutation,
  type WebTaskAccepted,
} from '../contracts/web.js';
import type { ScheduleService } from '../tasks/schedule-service.js';
import type { TaskService } from '../tasks/task-service.js';
import type { SourceManagementService } from './source-management-service.js';

/** 应用层数据结构或端口契约。 */
export interface WebSourceRepository {
  list(): readonly WebSource[];
  get(id: JobSourceId): WebSource | null;
  setEnabled(id: JobSourceId, enabled: boolean): WebSource;
  listChannels(): readonly WebSourceChannel[];
  getChannel(id: SourceChannelId): WebSourceChannel | null;
  setChannelEnabled(id: SourceChannelId, enabled: boolean): WebSourceChannel;
}

/** 应用层使用的类型约束。 */
export type WebSourceMutationResult =
  | { readonly kind: 'task'; readonly task: WebTaskAccepted }
  | { readonly kind: 'tasks'; readonly tasks: readonly WebTaskAccepted[] }
  | { readonly kind: 'source'; readonly source: WebSource }
  | { readonly kind: 'channel'; readonly channel: WebSourceChannel };

/** 编排 Web 来源和渠道的启停、编辑与策略更新。 */
export class WebSourceService {
  readonly #repository: WebSourceRepository;
  readonly #sources: SourceManagementService;
  readonly #tasks: TaskService;
  readonly #schedules: ScheduleService;
  readonly #ids: IdGenerator;

  /** 执行应用组件对外暴露的操作。 */
  public constructor(input: {
    readonly repository: WebSourceRepository;
    readonly sources: SourceManagementService;
    readonly tasks: TaskService;
    readonly schedules: ScheduleService;
    readonly ids: IdGenerator;
  }) {
    this.#repository = input.repository;
    this.#sources = input.sources;
    this.#tasks = input.tasks;
    this.#schedules = input.schedules;
    this.#ids = input.ids;
  }

  /** 执行应用组件对外暴露的操作。 */
  public list(): readonly WebSource[] {
    return this.#repository.list().map((source) => webSourceSchema.parse(source));
  }

  /** 执行应用组件对外暴露的操作。 */
  public listChannels(): readonly WebSourceChannel[] {
    return this.#repository.listChannels().map((channel) => webSourceChannelSchema.parse(channel));
  }

  /** 修改来源渠道并同步关联来源状态。 */
  public mutateChannel(input: WebSourceChannelMutation): WebSourceMutationResult {
    const mutation = webSourceChannelMutationSchema.parse(input);
    const channelId = parseId(mutation.channelId, 'SourceChannel');
    const channel = this.#repository.getChannel(channelId);
    if (!channel) throw new TypeError('Source channel not found.');
    if (mutation.kind === 'enable') {
      if (mutation.enabled && channel.channel !== this.#sources.activeChannel()) {
        throw new TypeError('请先在设置中切换同步招聘渠道。');
      }
      return {
        kind: 'channel',
        channel: this.#repository.setChannelEnabled(channelId, mutation.enabled),
      };
    }
    const results = this.#sources.enqueueChannelSync({
      channelIds: [channelId],
      idempotencyToken: mutation.idempotencyToken,
    });
    if (results.length === 0)
      throw new TypeError('Source channel has no enabled physical sources.');
    return { kind: 'tasks', tasks: results.map((result) => this.#task(result)) };
  }

  /** 修改单个来源配置并返回变更结果。 */
  public mutate(input: WebSourceMutation): WebSourceMutationResult {
    const mutation = webSourceMutationSchema.parse(input);
    const sourceId = parseId(mutation.sourceId, 'JobSource');
    if (!this.#repository.get(sourceId)) throw new TypeError('Source not found.');
    switch (mutation.kind) {
      case 'sync': {
        const result = this.#sources.enqueueSync({
          sourceIds: [sourceId],
          idempotencyToken: mutation.idempotencyToken,
        })[0];
        if (!result) throw new TypeError('Source sync task was not created.');
        return { kind: 'task', task: this.#task(result) };
      }
      case 'health': {
        const result = this.#tasks.enqueue({
          taskType: 'source.health-check',
          payload: { sourceId },
          idempotencyKey: `source.health:${sourceId}:${mutation.idempotencyToken}`,
        });
        return { kind: 'task', task: this.#task(result) };
      }
      case 'enable':
        return {
          kind: 'source',
          source: webSourceSchema.parse(this.#repository.setEnabled(sourceId, mutation.enabled)),
        };
      case 'schedule':
        if (
          mutation.enabled &&
          this.#sources.get(sourceId)?.channel !== this.#sources.activeChannel()
        ) {
          throw new TypeError('请先在设置中切换同步招聘渠道。');
        }
        if (mutation.enabled) this.#sources.requireSyncReady();
        this.#schedules.upsert({
          id: this.#ids.generate(),
          scheduleKey: `source.sync:${sourceId}`,
          taskType: 'source.sync',
          payload: { sourceId, trigger: 'schedule' },
          cronExpression: mutation.cronExpression,
          timezone: mutation.timezone,
          enabled: mutation.enabled,
        });
        return {
          kind: 'source',
          source: webSourceSchema.parse(this.#repository.get(sourceId)),
        };
    }
  }

  /** 处理应用类内部的辅助逻辑。 */
  #task(result: ReturnType<TaskService['enqueue']>): WebTaskAccepted {
    return webTaskAcceptedSchema.parse({
      taskId: result.task.id,
      status: result.task.status,
      deduplicated: result.kind !== 'enqueued',
      statusUrl: `/api/tasks/${result.task.id}`,
    });
  }
}
