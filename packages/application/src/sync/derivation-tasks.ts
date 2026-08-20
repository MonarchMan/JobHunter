import { parseId, type IdGenerator, type TaskId } from '@jobhunter/domain';
import type { DerivationTaskFactory } from './model.js';

export class DefaultDerivationTaskFactory implements DerivationTaskFactory {
  readonly #ids: IdGenerator;
  readonly #enrichmentVersion: string;

  public constructor(ids: IdGenerator, enrichmentVersion: string) {
    this.#ids = ids;
    this.#enrichmentVersion = enrichmentVersion;
  }

  #id(): TaskId {
    return parseId(this.#ids.generate(), 'Task');
  }

  public forRevision(input: { readonly revisionId: string; readonly enrich: boolean }): readonly {
    readonly id: TaskId;
    readonly taskType: string;
    readonly payload: unknown;
    readonly idempotencyKey: string;
  }[] {
    const tasks: {
      readonly id: TaskId;
      readonly taskType: string;
      readonly payload: unknown;
      readonly idempotencyKey: string;
    }[] = [
      {
        id: this.#id(),
        taskType: 'match.compute-revision',
        payload: { jobRevisionId: input.revisionId, jobEnrichmentId: null },
        idempotencyKey: `match.base:${input.revisionId}`,
      },
    ];
    if (input.enrich) {
      tasks.push({
        id: this.#id(),
        taskType: 'job.enrich',
        payload: { jobRevisionId: input.revisionId, enrichmentVersion: this.#enrichmentVersion },
        idempotencyKey: `job.enrich:${input.revisionId}:${this.#enrichmentVersion}`,
      });
    }
    return tasks;
  }
}

export function enrichmentAwareMatchTask(input: {
  readonly ids: IdGenerator;
  readonly revisionId: string;
  readonly enrichmentId: string;
}): {
  readonly id: TaskId;
  readonly taskType: string;
  readonly payload: unknown;
  readonly idempotencyKey: string;
} {
  return {
    id: parseId(input.ids.generate(), 'Task'),
    taskType: 'match.compute-revision',
    payload: { jobRevisionId: input.revisionId, jobEnrichmentId: input.enrichmentId },
    idempotencyKey: `match.enriched:${input.revisionId}:${input.enrichmentId}`,
  };
}

export function matchAdviceTask(input: {
  readonly ids: IdGenerator;
  readonly matchResultId: string;
  readonly adviceVersion: string;
}): {
  readonly id: TaskId;
  readonly taskType: string;
  readonly payload: unknown;
  readonly idempotencyKey: string;
} {
  return {
    id: parseId(input.ids.generate(), 'Task'),
    taskType: 'match.advise',
    payload: { matchResultId: input.matchResultId, adviceVersion: input.adviceVersion },
    idempotencyKey: `match.advise:${input.matchResultId}:${input.adviceVersion}`,
  };
}
