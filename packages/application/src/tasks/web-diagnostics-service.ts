import { parseId } from '@jobhunter/domain';
import { z } from 'zod';
import {
  webAgentRunDetailSchema,
  webDiagnosticsSchema,
  webPagination,
  webTaskAcceptedSchema,
  webTaskMutationSchema,
  webTaskSchema,
  type WebSourceSyncTaskDetail,
  type WebJobDetailBatch,
  type WebAgentRunDetail,
  type WebAgentRunSummary,
  type WebDiagnostics,
  type WebTask,
  type WebTaskAccepted,
  type WebTaskMutation,
} from '../contracts/web.js';
import type { TaskRecord } from './model.js';
import type { TaskService } from './task-service.js';

/** 应用层数据结构或端口契约。 */
export interface WebDiagnosticsRepository {
  listTaskEntries(input: {
    readonly status?: TaskRecord['status'];
    readonly taskType?: string;
    readonly limit: number;
    readonly offset: number;
  }): {
    readonly items: readonly WebTaskListEntry[];
    readonly total: number;
  };
  listAgentRuns(input: { readonly limit: number; readonly offset: number }): {
    readonly items: readonly WebAgentRunSummary[];
    readonly total: number;
  };
  getAgentRun(id: string): WebAgentRunDetail | null;
  getSourceSyncTaskDetail(input: {
    readonly sourceId: string;
    readonly trigger: 'manual' | 'schedule' | 'retry';
    readonly windowStartedAt: number;
    readonly windowFinishedAt: number | null;
  }): WebSourceSyncTaskDetail | null;
}

/** 应用层使用的类型约束。 */
export type WebTaskListEntry =
  | { readonly kind: 'task'; readonly taskId: string }
  | {
      readonly kind: 'source_job_detail_batch';
      readonly id: string;
      readonly status: TaskRecord['status'];
      readonly createdAt: number;
      readonly startedAt: number | null;
      readonly finishedAt: number | null;
      readonly cancelRequested: boolean;
      readonly batch: WebJobDetailBatch;
    };

/** 应用层使用的类型约束。 */
export type WebTaskMutationResult =
  | { readonly kind: 'task'; readonly task: WebTask }
  | { readonly kind: 'accepted'; readonly task: WebTaskAccepted }
  | { readonly kind: 'not_found' };

/** 执行应用层的解析、转换或编排辅助逻辑。 */
function instant(value: number | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

/** 执行应用层的解析、转换或编排辅助逻辑。 */
function presentTask(task: TaskRecord, repository: WebDiagnosticsRepository): WebTask {
  const sourceSyncPayload =
    task.taskType === 'source.sync'
      ? z
          .object({
            sourceId: z.string().trim().min(1),
            trigger: z.enum(['manual', 'schedule', 'retry']),
          })
          .strict()
          .safeParse(task.payload)
      : null;
  return webTaskSchema.parse({
    kind: 'task',
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
    sourceSync:
      sourceSyncPayload?.success === true
        ? repository.getSourceSyncTaskDetail({
            sourceId: sourceSyncPayload.data.sourceId,
            trigger: sourceSyncPayload.data.trigger,
            windowStartedAt: task.startedAt ?? task.createdAt,
            windowFinishedAt: task.finishedAt,
          })
        : null,
    jobDetailBatch: null,
  });
}

/** 执行应用层的解析、转换或编排辅助逻辑。 */
function presentTaskEntry(
  entry: WebTaskListEntry,
  tasks: Pick<TaskService, 'get'>,
  repository: WebDiagnosticsRepository,
): WebTask | null {
  if (entry.kind === 'task') {
    const task = tasks.get(parseId(entry.taskId, 'Task'));
    return task ? presentTask(task, repository) : null;
  }
  return webTaskSchema.parse({
    kind: entry.kind,
    id: entry.id,
    taskType: 'source.job-detail',
    status: entry.status,
    attemptCount: 0,
    maxAttempts: 3,
    retryOfTaskId: null,
    errorCategory: entry.batch.counts.failed > 0 ? 'batch_partial_failure' : null,
    errorSummary:
      entry.batch.counts.failed > 0
        ? `${String(entry.batch.counts.failed)} 个职位详情任务失败。`
        : null,
    cancelRequested: entry.cancelRequested,
    createdAt: new Date(entry.createdAt).toISOString(),
    startedAt: instant(entry.startedAt),
    finishedAt: instant(entry.finishedAt),
    sourceSync: null,
    jobDetailBatch: entry.batch,
  });
}

/** Exposes operational metadata only; task payloads and Agent inputs/outputs stay private. */
/** 执行应用层的解析、转换或编排辅助逻辑。 */
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

  /** 执行应用组件对外暴露的操作。 */
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
      ...(input.status ? { status: input.status } : {}),
      ...(input.taskType ? { taskType: input.taskType } : {}),
    };
    let taskPageResult = this.#repository.listTaskEntries({
      ...taskFilter,
      limit: pageSize,
      offset: (taskPage - 1) * pageSize,
    });
    const taskPagination = webPagination(taskPageResult.total, taskPage, pageSize);
    if (taskPagination.current !== taskPage) {
      taskPageResult = this.#repository.listTaskEntries({
        ...taskFilter,
        limit: pageSize,
        offset: (taskPagination.current - 1) * pageSize,
      });
    }
    const agentPageResult = this.#repository.listAgentRuns({
      limit: pageSize,
      offset: (agentPage - 1) * pageSize,
    });
    const agentPagination = webPagination(agentPageResult.total, agentPage, pageSize);
    return webDiagnosticsSchema.parse({
      tasks: taskPageResult.items
        .map((entry) => presentTaskEntry(entry, this.#tasks, this.#repository))
        .filter((task): task is WebTask => task !== null),
      taskPagination,
      agentRuns: agentPageResult.items,
      agentPagination,
    });
  }

  /** 执行应用组件对外暴露的操作。 */
  public getTask(id: string): WebTask | null {
    const task = this.#tasks.get(parseId(id, 'Task'));
    return task ? presentTask(task, this.#repository) : null;
  }

  /** 执行应用组件对外暴露的操作。 */
  public getAgentRun(id: string): WebAgentRunDetail | null {
    const run = this.#repository.getAgentRun(id);
    return run ? webAgentRunDetailSchema.parse(run) : null;
  }

  /** 执行应用组件对外暴露的操作。 */
  public mutate(input: WebTaskMutation): WebTaskMutationResult {
    const mutation = webTaskMutationSchema.parse(input);
    const taskId = parseId(mutation.taskId, 'Task');
    if (mutation.kind === 'cancel') {
      const result = this.#tasks.cancel(taskId);
      return result.kind === 'not_found'
        ? { kind: 'not_found' }
        : { kind: 'task', task: presentTask(result.task, this.#repository) };
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
