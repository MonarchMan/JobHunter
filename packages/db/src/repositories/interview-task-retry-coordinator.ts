import {
  experienceResearchTaskPayloadSchema,
  projectAnswerDigestTaskPayloadSchema,
  projectQuestionTaskPayloadSchema,
  type EnqueueTaskResult,
  type TaskRetryCoordinator,
} from '@jobhunter/application';
import { canonicalJson } from '@jobhunter/domain';
import type Database from 'better-sqlite3';
import type { SqliteTaskRepository } from './task-repository.js';

export class SqliteInterviewTaskRetryCoordinator implements TaskRetryCoordinator {
  readonly #client: Database.Database;
  readonly #tasks: SqliteTaskRepository;

  public constructor(client: Database.Database, tasks: SqliteTaskRepository) {
    this.#client = client;
    this.#tasks = tasks;
  }

  public enqueueRetry(
    input: Parameters<TaskRetryCoordinator['enqueueRetry']>[0],
  ): EnqueueTaskResult {
    return this.#client
      .transaction(() => {
        const result = this.#tasks.enqueue(input.retry);
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

  #link(
    taskType: string,
    payload: unknown,
    sourceTaskId: string,
    retryTaskId: string,
    retriedAt: number,
  ): boolean {
    if (taskType === 'interview.experience-research.execute') {
      const parsed = experienceResearchTaskPayloadSchema.parse(payload);
      return this.#replaceTaskReference({
        table: 'experience_research_requests',
        idColumn: 'id',
        taskColumn: 'current_task_id',
        id: parsed.requestId,
        sourceTaskId,
        retryTaskId,
        retriedAt,
        statusClause: "state = 'ready' AND bundle_import_token IS NULL",
      });
    }
    if (taskType === 'interview.project-question') {
      const parsed = projectQuestionTaskPayloadSchema.parse(payload);
      return this.#replaceTaskReference({
        table: 'drill_turns',
        idColumn: 'id',
        taskColumn: 'question_task_id',
        id: parsed.turnId,
        sourceTaskId,
        retryTaskId,
        retriedAt,
        statusClause: "status = 'question_pending'",
      });
    }
    if (taskType === 'interview.project-answer-digest') {
      const parsed = projectAnswerDigestTaskPayloadSchema.parse(payload);
      return this.#replaceTaskReference({
        table: 'drill_turns',
        idColumn: 'id',
        taskColumn: 'digest_task_id',
        id: parsed.turnId,
        sourceTaskId,
        retryTaskId,
        retriedAt,
        statusClause: "status = 'digest_pending'",
      });
    }
    return true;
  }

  #replaceTaskReference(input: {
    readonly table: 'experience_research_requests' | 'drill_turns';
    readonly idColumn: 'id';
    readonly taskColumn: 'current_task_id' | 'question_task_id' | 'digest_task_id';
    readonly id: string;
    readonly sourceTaskId: string;
    readonly retryTaskId: string;
    readonly retriedAt: number;
    readonly statusClause: string;
  }): boolean {
    const current = this.#client
      .prepare(`SELECT ${input.taskColumn} FROM ${input.table} WHERE ${input.idColumn} = ?`)
      .pluck()
      .get(input.id) as string | null | undefined;
    if (current === input.retryTaskId) return true;
    if (current !== input.sourceTaskId) return false;
    return (
      this.#client
        .prepare(
          `UPDATE ${input.table} SET ${input.taskColumn} = ?, updated_at = ?
           WHERE ${input.idColumn} = ? AND ${input.taskColumn} = ? AND ${input.statusClause}`,
        )
        .run(input.retryTaskId, input.retriedAt, input.id, input.sourceTaskId).changes === 1
    );
  }
}
