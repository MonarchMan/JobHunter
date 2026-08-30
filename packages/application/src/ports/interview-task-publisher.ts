import type { DrillTurnId, ExperienceResearchRequestId, UtcInstant } from '@jobhunter/domain';
import type { EnqueueTaskResult } from '../tasks/model.js';
import type { EnqueueTaskCommand } from '../tasks/task-service.js';

export class InterviewTaskPublicationConflictError extends Error {
  public constructor() {
    super('Another interview task is still finishing.');
    this.name = 'InterviewTaskPublicationConflictError';
  }
}

export interface InterviewTaskPublisher {
  publishProjectQuestion(input: {
    readonly command: EnqueueTaskCommand;
    readonly turnId: DrillTurnId;
    readonly now: UtcInstant;
  }): EnqueueTaskResult;
  publishProjectAnswerDigest(input: {
    readonly command: EnqueueTaskCommand;
    readonly turnId: DrillTurnId;
    readonly now: UtcInstant;
  }): EnqueueTaskResult;
  publishExperienceResearch(input: {
    readonly command: EnqueueTaskCommand;
    readonly requestId: ExperienceResearchRequestId;
    readonly expectedRevision: number;
    readonly now: UtcInstant;
  }): EnqueueTaskResult;
}
