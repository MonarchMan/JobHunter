import {
  webResumeDeletionConfirmSchema,
  webResumeDeletionImpactSchema,
  type WebResumeDeletionConfirm,
  type WebResumeDeletionImpact,
} from '@jobhunter/user/contracts/web';
import { webTaskAcceptedSchema, type WebTaskAccepted } from '@jobhunter/common/web-contracts';
import type { TaskService } from '@jobhunter/common/tasks';
import type { ResumeDeletionService } from '@jobhunter/user/profile/resume-deletion-service';

/** Keeps destructive execution in Worker while exposing a stable preview/confirm protocol. */
/** 执行应用层的解析、转换或编排辅助逻辑。 */
export class WebResumeDeletionService {
  readonly #deletion: ResumeDeletionService;
  readonly #tasks: TaskService;

  public constructor(input: {
    readonly deletion: ResumeDeletionService;
    readonly tasks: TaskService;
  }) {
    this.#deletion = input.deletion;
    this.#tasks = input.tasks;
  }

  /** 执行应用组件对外暴露的操作。 */
  public preview(resumeDocumentId: string): WebResumeDeletionImpact {
    const result = this.#deletion.preview(resumeDocumentId);
    return webResumeDeletionImpactSchema.parse({
      resumeDocumentId,
      impactHash: result.impactHash,
      counts: result.counts,
      warnings: [
        '删除不可撤销；画像、模板草稿、头像、未过期导出、匹配结果和独占 Agent 运行可能一并删除。',
      ],
    });
  }

  public confirm(input: WebResumeDeletionConfirm): WebTaskAccepted {
    const command = webResumeDeletionConfirmSchema.parse(input);
    // Re-preview before enqueue so stale confirmations fail synchronously.
    const current = this.preview(command.resumeDocumentId);
    if (current.impactHash !== command.expectedImpactHash) {
      throw new TypeError('Resume deletion impact changed; preview again.');
    }
    const result = this.#tasks.enqueue({
      taskType: 'resume.delete.confirmed',
      payload: {
        resumeDocumentId: command.resumeDocumentId,
        expectedImpactHash: command.expectedImpactHash,
      },
      idempotencyKey: `resume.delete:${command.resumeDocumentId}:${command.expectedImpactHash}:${command.idempotencyToken}`,
    });
    return webTaskAcceptedSchema.parse({
      taskId: result.task.id,
      status: result.task.status,
      deduplicated: result.kind !== 'enqueued',
      statusUrl: `/api/tasks/${result.task.id}`,
    });
  }
}
