import { parseId, type IdGenerator, type JobSourceId } from '@jobhunter/domain';
import {
  webSourceMutationSchema,
  webSourceSchema,
  webTaskAcceptedSchema,
  type WebSource,
  type WebSourceMutation,
  type WebTaskAccepted,
} from '../contracts/web.js';
import type { ScheduleService } from '../tasks/schedule-service.js';
import type { TaskService } from '../tasks/task-service.js';
import type { SourceManagementService } from './source-management-service.js';

export interface WebSourceRepository {
  list(): readonly WebSource[];
  get(id: JobSourceId): WebSource | null;
  setEnabled(id: JobSourceId, enabled: boolean): WebSource;
}

export type WebSourceMutationResult =
  | { readonly kind: 'task'; readonly task: WebTaskAccepted }
  | { readonly kind: 'source'; readonly source: WebSource };

export class WebSourceService {
  readonly #repository: WebSourceRepository;
  readonly #sources: SourceManagementService;
  readonly #tasks: TaskService;
  readonly #schedules: ScheduleService;
  readonly #ids: IdGenerator;

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

  public list(): readonly WebSource[] {
    return this.#repository.list().map((source) => webSourceSchema.parse(source));
  }

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

  #task(result: ReturnType<TaskService['enqueue']>): WebTaskAccepted {
    return webTaskAcceptedSchema.parse({
      taskId: result.task.id,
      status: result.task.status,
      deduplicated: result.kind !== 'enqueued',
      statusUrl: `/api/tasks/${result.task.id}`,
    });
  }
}
