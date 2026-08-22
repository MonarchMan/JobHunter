import { parseId } from '@jobhunter/domain';
import {
  webAgentRunDetailSchema,
  webDiagnosticsSchema,
  webTaskAcceptedSchema,
  webTaskMutationSchema,
  webTaskSchema,
  type WebAgentRunDetail,
  type WebAgentRunSummary,
  type WebDiagnostics,
  type WebTask,
  type WebTaskAccepted,
  type WebTaskMutation,
} from '../contracts/web.js';
import type { TaskRecord } from './model.js';
import type { TaskService } from './task-service.js';

export interface WebDiagnosticsRepository {
  listAgentRuns(limit: number): readonly WebAgentRunSummary[];
  getAgentRun(id: string): WebAgentRunDetail | null;
}

export type WebTaskMutationResult =
  | { readonly kind: 'task'; readonly task: WebTask }
  | { readonly kind: 'accepted'; readonly task: WebTaskAccepted }
  | { readonly kind: 'not_found' };

function instant(value: number | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

function presentTask(task: TaskRecord): WebTask {
  return webTaskSchema.parse({
    id: task.id,
    taskType: task.taskType,
    status: task.status,
    attemptCount: task.attemptCount,
    maxAttempts: task.maxAttempts,
    retryOfTaskId: task.retryOfTaskId,
    errorCategory: task.errorCategory,
    errorSummary: task.errorSummary,
    cancelRequested: task.cancelRequestedAt !== null,
    createdAt: new Date(task.createdAt).toISOString(),
    startedAt: instant(task.startedAt),
    finishedAt: instant(task.finishedAt),
  });
}

/** Exposes operational metadata only; task payloads and Agent inputs/outputs stay private. */
export class WebDiagnosticsService {
  readonly #tasks: TaskService;
  readonly #repository: WebDiagnosticsRepository;

  public constructor(input: {
    readonly tasks: TaskService;
    readonly repository: WebDiagnosticsRepository;
  }) {
    this.#tasks = input.tasks;
    this.#repository = input.repository;
  }

  public list(): WebDiagnostics {
    return webDiagnosticsSchema.parse({
      tasks: this.#tasks.list({ limit: 100 }).map(presentTask),
      agentRuns: this.#repository.listAgentRuns(100),
    });
  }

  public getTask(id: string): WebTask | null {
    const task = this.#tasks.get(parseId(id, 'Task'));
    return task ? presentTask(task) : null;
  }

  public getAgentRun(id: string): WebAgentRunDetail | null {
    const run = this.#repository.getAgentRun(id);
    return run ? webAgentRunDetailSchema.parse(run) : null;
  }

  public mutate(input: WebTaskMutation): WebTaskMutationResult {
    const mutation = webTaskMutationSchema.parse(input);
    const taskId = parseId(mutation.taskId, 'Task');
    if (mutation.kind === 'cancel') {
      const result = this.#tasks.cancel(taskId);
      return result.kind === 'not_found'
        ? { kind: 'not_found' }
        : { kind: 'task', task: presentTask(result.task) };
    }
    if (!this.#tasks.get(taskId)) return { kind: 'not_found' };
    const result = this.#tasks.retryFailed(taskId, mutation.idempotencyToken);
    return {
      kind: 'accepted',
      task: webTaskAcceptedSchema.parse({
        taskId: result.task.id,
        status: result.task.status,
        deduplicated: result.kind !== 'enqueued',
        statusUrl: `/api/tasks/${result.task.id}`,
      }),
    };
  }
}
