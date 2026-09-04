import { InterviewTaskPublicationConflictError } from '@jobhunter/application';
import type {
  EnqueueTaskResult,
  EnqueueTaskCommand,
  InterviewProjectRepository,
  InterviewResearchRepository,
  InterviewTaskPublisher,
  TaskService,
} from '@jobhunter/application';
import { canonicalJson } from '@jobhunter/domain';
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
  readonly #projects: InterviewProjectRepository;
  readonly #research: InterviewResearchRepository;

  /** 执行数据库组件对外暴露的操作。 */
  public constructor(input: {
    readonly client: Database.Database;
    readonly tasks: TaskService;
    readonly projects: InterviewProjectRepository;
    readonly research: InterviewResearchRepository;
  }) {
    this.#client = input.client;
    this.#tasks = input.tasks;
    this.#projects = input.projects;
    this.#research = input.research;
  }

  /** 执行数据库组件对外暴露的操作。 */
  public publishProjectQuestion(
    input: Parameters<InterviewTaskPublisher['publishProjectQuestion']>[0],
  ): ReturnType<InterviewTaskPublisher['publishProjectQuestion']> {
    return this.#client
      .transaction(() => {
        const result = this.#tasks.enqueue(input.command);
        assertSameTaskIntent(result, input.command);
        this.#projects.attachQuestionTask({
          turnId: input.turnId,
          taskId: result.task.id,
          now: input.now,
        });
        return result;
      })
      .immediate();
  }

  /** 执行数据库组件对外暴露的操作。 */
  public publishProjectAnswerDigest(
    input: Parameters<InterviewTaskPublisher['publishProjectAnswerDigest']>[0],
  ): ReturnType<InterviewTaskPublisher['publishProjectAnswerDigest']> {
    return this.#client
      .transaction(() => {
        const result = this.#tasks.enqueue(input.command);
        assertSameTaskIntent(result, input.command);
        this.#projects.attachDigestTask({
          turnId: input.turnId,
          taskId: result.task.id,
          now: input.now,
        });
        return result;
      })
      .immediate();
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
        return result;
      })
      .immediate();
  }
}
