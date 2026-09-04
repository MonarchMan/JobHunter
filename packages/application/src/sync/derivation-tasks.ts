import type { TaskId } from '@jobhunter/domain';
import type { DerivationTaskFactory } from './model.js';

/** 为职位修订生成默认的理解、匹配和建议派生任务。 */
export class DefaultDerivationTaskFactory implements DerivationTaskFactory {
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
