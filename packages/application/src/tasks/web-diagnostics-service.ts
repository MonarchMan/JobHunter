import { parseId } from '@jobhunter/domain';
import {
  webAgentRunDetailSchema,
  webDiagnosticsSchema,
  webPagination,
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
  listAgentRuns(input: { readonly limit: number; readonly offset: number }): {
    readonly items: readonly WebAgentRunSummary[];
    readonly total: number;
  };
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

  public list(
    input: {
      readonly status?: TaskRecord['status'];
      readonly taskType?: string;
      readonly taskPage?: number;
      readonly agentPage?: number;
      readonly pageSize?: number;
    } = {},
  ): WebDiagnostics {
    const pageSize = input.pageSize ?? 25;
    const taskPage = input.taskPage ?? 1;
    const agentPage = input.agentPage ?? 1;
    const taskFilter = {
      ...(input.status ? { statuses: [input.status] } : {}),
      ...(input.taskType ? { taskType: input.taskType } : {}),
    };
    const taskTotal = this.#tasks.count(taskFilter);
    const taskPagination = webPagination(taskTotal, taskPage, pageSize);
    const agentPageResult = this.#repository.listAgentRuns({
      limit: pageSize,
      offset: (agentPage - 1) * pageSize,
    });
    const agentPagination = webPagination(agentPageResult.total, agentPage, pageSize);
    return webDiagnosticsSchema.parse({
      tasks: this.#tasks
        .list({
          ...taskFilter,
          limit: pageSize,
          offset: (taskPagination.current - 1) * pageSize,
        })
        .map(presentTask),
      taskPagination,
      agentRuns: agentPageResult.items,
      agentPagination,
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
