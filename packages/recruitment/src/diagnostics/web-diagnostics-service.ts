import { parseId } from '@jobhunter/common/domain';
import {
  webAgentRunDetailSchema,
  webDiagnosticsSchema,
  webTaskMutationSchema,
  webTaskSchema,
  type WebJobDetailBatch,
  type WebAgentRunDetail,
  type WebAgentRunSummary,
  type WebDiagnostics,
  type WebTask,
  type WebTaskMutation,
} from '@jobhunter/recruitment/contracts/web';
import {
  webPagination,
  webTaskAcceptedSchema,
  type WebTaskAccepted,
} from '@jobhunter/common/web-contracts';
import type { TaskRecord } from '@jobhunter/common/tasks';
import type { TaskService } from '@jobhunter/common/tasks';

/** 应用层数据结构或端口契约。 */
export interface WebDiagnosticsRepository {
  /** 批量读取当前页普通任务及关联来源信息，不返回执行 payload。 */
  getTaskDetails(ids: readonly string[]): readonly WebTask[];
  /** 时间边界为 UTC 毫秒、含首不含尾；先筛选完整批次再分页计数。 */
  listTaskEntries(input: {
    readonly batchRunId?: string;
    readonly since?: number;
    readonly before?: number;
    readonly status?: TaskRecord['status'] | 'warning';
    readonly taskType?: string;
    readonly limit: number;
    readonly offset: number;
  }): {
    readonly items: readonly WebTaskListEntry[];
    readonly total: number;
  };
  /** 与任务列表共用时间窗口，按 Agent 开始时间筛选并统计总数。 */
  listAgentRuns(input: {
    readonly limit: number;
    readonly offset: number;
    readonly since?: number;
    readonly before?: number;
  }): {
    readonly items: readonly WebAgentRunSummary[];
    readonly total: number;
  };
  getAgentRun(id: string): WebAgentRunDetail | null;
}

/** 应用层使用的类型约束。 */
export type WebTaskListEntry =
  | { readonly kind: 'task'; readonly taskId: string }
  | {
      readonly kind: 'source_job_detail_batch';
      readonly attemptCount: number;
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
function presentTaskEntry(
  entry: WebTaskListEntry,
  details: ReadonlyMap<string, WebTask>,
): WebTask | null {
  if (entry.kind === 'task') {
    return details.get(entry.taskId) ?? null;
  }
  return webTaskSchema.parse({
    kind: entry.kind,
    id: entry.id,
    taskType: 'source.job-detail',
    status: entry.status,
    attemptCount: entry.attemptCount,
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
    syncScoring: null,
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
      readonly since?: number;
      readonly before?: number;
      readonly status?: TaskRecord['status'] | 'warning';
      readonly taskType?: string;
      readonly taskPage?: number;
      readonly agentPage?: number;
      readonly pageSize?: number;
      readonly taskPageSize?: number;
      readonly agentPageSize?: number;
    } = {},
  ): WebDiagnostics {
    const taskPageSize = input.taskPageSize ?? input.pageSize ?? 25;
    const agentPageSize = input.agentPageSize ?? input.pageSize ?? 25;
    const taskPage = input.taskPage ?? 1;
    const agentPage = input.agentPage ?? 1;
    const timeFilter = {
      ...(input.since !== undefined ? { since: input.since } : {}),
      ...(input.before !== undefined ? { before: input.before } : {}),
    };
    const taskFilter = {
      ...timeFilter,
      ...(input.status ? { status: input.status } : {}),
      ...(input.taskType ? { taskType: input.taskType } : {}),
    };
    let taskPageResult = this.#repository.listTaskEntries({
      ...taskFilter,
      limit: taskPageSize,
      offset: (taskPage - 1) * taskPageSize,
    });
    const taskPagination = webPagination(taskPageResult.total, taskPage, taskPageSize);
    if (taskPagination.current !== taskPage) {
      taskPageResult = this.#repository.listTaskEntries({
        ...taskFilter,
        limit: taskPageSize,
        offset: (taskPagination.current - 1) * taskPageSize,
      });
    }
    let agentPageResult = this.#repository.listAgentRuns({
      ...timeFilter,
      limit: agentPageSize,
      offset: (agentPage - 1) * agentPageSize,
    });
    const agentPagination = webPagination(agentPageResult.total, agentPage, agentPageSize);
    if (agentPagination.current !== agentPage) {
      agentPageResult = this.#repository.listAgentRuns({
        ...timeFilter,
        limit: agentPageSize,
        offset: (agentPagination.current - 1) * agentPageSize,
      });
    }
    // 1、确定有效页后一次性读取普通任务，避免逐条查询任务及同步运行。
    const details = new Map(
      this.#repository
        .getTaskDetails(
          taskPageResult.items.flatMap((entry) => (entry.kind === 'task' ? [entry.taskId] : [])),
        )
        .map((task) => [task.id, task]),
    );
    // 2、按原分页顺序合并普通任务与批次，统一校验安全展示契约。
    return webDiagnosticsSchema.parse({
      tasks: taskPageResult.items
        .map((entry) => presentTaskEntry(entry, details))
        .filter((task): task is WebTask => task !== null),
      taskPagination,
      agentRuns: agentPageResult.items,
      agentPagination,
    });
  }

  /** 执行应用组件对外暴露的操作。 */
  public getTask(id: string): WebTask | null {
    return this.#repository.getTaskDetails([parseId(id, 'Task')])[0] ?? null;
  }

  /** 按同步运行 ID 读取合成批次；不与普通任务 ID 混用。 */
  public getTaskBatch(id: string): WebTask | null {
    const [entry] = this.#repository.listTaskEntries({
      batchRunId: parseId(id, 'SourceRun'),
      limit: 1,
      offset: 0,
    }).items;
    return entry?.kind === 'source_job_detail_batch' ? presentTaskEntry(entry, new Map()) : null;
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
    // 1、维护任务仅供审计，重查由持久化周期驱动，不能转交普通 Handler。
    if (this.#tasks.get(taskId)?.taskType === 'maintenance.sqlite')
      throw new TypeError('SQLite maintenance audit is read-only.');
    if (mutation.kind === 'cancel') {
      const result = this.#tasks.cancel(taskId);
      const task = result.kind === 'not_found' ? null : this.getTask(result.task.id);
      return task ? { kind: 'task', task } : { kind: 'not_found' };
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
