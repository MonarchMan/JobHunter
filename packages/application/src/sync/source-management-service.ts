import type { IdGenerator, JobSourceId } from '@jobhunter/domain';
import type { SourceManagementRepository, SourceOverview } from '../ports/source-management.js';
import type { EnqueueTaskResult, TaskRecord } from '../tasks/model.js';
import type { TaskService } from '../tasks/task-service.js';

export class SourceManagementService {
  readonly #sources: SourceManagementRepository;
  readonly #tasks: TaskService;
  readonly #ids: IdGenerator;

  public constructor(input: {
    readonly sources: SourceManagementRepository;
    readonly tasks: TaskService;
    readonly ids: IdGenerator;
  }) {
    this.#sources = input.sources;
    this.#tasks = input.tasks;
    this.#ids = input.ids;
  }

  public list(): readonly SourceOverview[] {
    return this.#sources.list();
  }

  public get(id: JobSourceId): SourceOverview | null {
    return this.#sources.get(id);
  }

  public enqueueSync(input: {
    readonly sourceIds: readonly JobSourceId[] | 'all';
  }): readonly EnqueueTaskResult[] {
    const selected =
      input.sourceIds === 'all'
        ? this.#sources.list().filter((source) => source.enabled)
        : input.sourceIds.map((id) => {
            const source = this.#sources.get(id);
            if (!source) throw new TypeError(`Source not found: ${id}`);
            if (!source.enabled) throw new TypeError(`Source is disabled: ${id}`);
            return source;
          });
    const token = this.#ids.generate();
    return selected.map((source) =>
      this.#tasks.enqueue({
        taskType: 'source.sync',
        payload: { sourceId: source.id, trigger: 'manual' },
        idempotencyKey: `source.sync:${source.id}:manual:${token}`,
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
