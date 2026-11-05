import type { ExperienceResearchRequestId, UtcInstant } from '@jobhunter/common/domain';
import type { EnqueueTaskResult, EnqueueTaskCommand } from '@jobhunter/common/tasks';

/** 同一面试对象仍有任务发布中的并发冲突。 */
export class InterviewTaskPublicationConflictError extends Error {
  public constructor() {
    super('Another interview task is still finishing.');
    this.name = 'InterviewTaskPublicationConflictError';
  }
}

/** 应用层数据结构或端口契约。 */
export interface InterviewTaskPublisher {
  publishExperienceResearch(input: {
    readonly command: EnqueueTaskCommand;
    readonly requestId: ExperienceResearchRequestId;
    readonly expectedRevision: number;
    readonly now: UtcInstant;
  }): EnqueueTaskResult;
}
