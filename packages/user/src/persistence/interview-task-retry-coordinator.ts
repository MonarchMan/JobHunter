import { experienceResearchTaskPayloadSchema } from '../interview/index.js';
import type { EnqueueTaskResult, TaskRetryCoordinator } from '@jobhunter/common/tasks';
import { canonicalJson } from '@jobhunter/common/domain';
import type Database from 'better-sqlite3';
import type { SqliteTaskRepository } from '@jobhunter/common/persistence/tasks';

/** 根据任务失败分类协调面试任务的重试与状态恢复。 */
export class SqliteInterviewTaskRetryCoordinator implements TaskRetryCoordinator {
  readonly #client: Database.Database;
  readonly #tasks: SqliteTaskRepository;

  public constructor(client: Database.Database, tasks: SqliteTaskRepository) {
    this.#client = client;
    this.#tasks = tasks;
  }

  /** 执行数据库组件对外暴露的操作。 */
  public enqueueRetry(
    input: Parameters<TaskRetryCoordinator['enqueueRetry']>[0],
  ): EnqueueTaskResult {
    return this.#client
      .transaction(() => {
        const result = this.#tasks.retry(input.retry);
        if (
          result.kind !== 'enqueued' &&
          (result.task.taskType !== input.retry.taskType ||
            canonicalJson(result.task.payload) !== canonicalJson(input.retry.payload))
        ) {
          throw new TypeError('Another task is active for this interview workflow.');
        }
        if (
          !this.#link(
            input.source.taskType,
            input.source.payload,
            input.source.id,
            result.task.id,
            input.retry.createdAt,
          )
        ) {
          throw new TypeError('Task retry is no longer linked to the active interview workflow.');
        }
        return result;
      })
      .immediate();
  }

  /** 处理数据库类内部的辅助逻辑。 */
  #link(
    taskType: string,
    payload: unknown,
    sourceTaskId: string,
    retryTaskId: string,
    retriedAt: number,
  ): boolean {
    if (taskType === 'interview.experience-research.execute') {
      const parsed = experienceResearchTaskPayloadSchema.parse(payload);
      return (
        this.#client
          .prepare(
            `UPDATE tasks SET private_state=json_set(private_state,
        '$.research.current_task_id', ?, '$.research.updated_at', ?)
        WHERE id=? AND task_type='interview.experience-research'
          AND json_extract(private_state,'$.research.current_task_id') IN (?,?)
          AND json_extract(private_state,'$.research.state')='ready'
          AND json_extract(private_state,'$.research.bundle_import_token') IS NULL`,
          )
          .run(retryTaskId, retriedAt, parsed.requestId, sourceTaskId, retryTaskId).changes === 1
      );
    }
    return true;
  }
}
