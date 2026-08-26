import type { IdGenerator, TaskId } from '@jobhunter/domain';
import type { DerivationTaskFactory } from './model.js';

export class DefaultDerivationTaskFactory implements DerivationTaskFactory {
  public constructor(_ids: IdGenerator) {}

  public forRevision(input: { readonly revisionId: string }): readonly {
    readonly id: TaskId;
    readonly taskType: string;
    readonly payload: unknown;
    readonly idempotencyKey: string;
  }[] {
    void input;
    return [];
  }
}
