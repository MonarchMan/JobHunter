import { InterviewTaskPublicationConflictError } from '../ports/interview-task-publisher.js';
import type { EnqueueTaskResult, EnqueueTaskCommand, TaskService } from '@jobhunter/common/tasks';
import type { InterviewResearchRepository } from '../ports/interview-research.js';
import type { InterviewTaskPublisher } from '../ports/interview-task-publisher.js';
import { canonicalJson } from '@jobhunter/common/domain';
import type Database from 'better-sqlite3';

/** 执行数据库结果的解析、转换或持久化辅助逻辑。 */
function assertSameTaskIntent(result: EnqueueTaskResult, command: EnqueueTaskCommand): void {
  if (result.kind === 'enqueued') return;
  if (
    result.task.taskType !== command.taskType ||
    canonicalJson(result.task.payload) !== canonicalJson(command.payload)
  ) {
    throw new InterviewTaskPublicationConflictError();
  }
}

/** 将面试领域任务发布到通用 tasks 队列并维护幂等绑定。 */
export class SqliteInterviewTaskPublisher implements InterviewTaskPublisher {
  readonly #client: Database.Database;
  readonly #tasks: TaskService;
  readonly #research: InterviewResearchRepository;

  /** 执行数据库组件对外暴露的操作。 */
  public constructor(input: {
    readonly client: Database.Database;
    readonly tasks: TaskService;
    readonly research: InterviewResearchRepository;
  }) {
    this.#client = input.client;
    this.#tasks = input.tasks;
    this.#research = input.research;
  }

  /** 执行数据库组件对外暴露的操作。 */
  public publishExperienceResearch(
    input: Parameters<InterviewTaskPublisher['publishExperienceResearch']>[0],
  ): ReturnType<InterviewTaskPublisher['publishExperienceResearch']> {
    return this.#client
      .transaction(() => {
        const result = this.#tasks.enqueue(input.command);
        assertSameTaskIntent(result, input.command);
        if (
          !this.#research.attachTask({
            requestId: input.requestId,
            expectedRevision: input.expectedRevision,
            taskId: result.task.id,
            now: input.now,
          })
        ) {
          throw new TypeError('Research request changed before task publication.');
        }
        this.#client
          .prepare('UPDATE tasks SET parent_task_id=? WHERE id=?')
          .run(input.requestId, result.task.id);
        this.#client
          .prepare(`UPDATE tasks SET public_state='{"phase":"executing"}' WHERE id=?`)
          .run(input.requestId);
        return result;
      })
      .immediate();
  }
}
