import {
  webResumeDeletionConfirmSchema,
  webResumeDeletionImpactSchema,
  webTaskAcceptedSchema,
  type WebResumeDeletionConfirm,
  type WebResumeDeletionImpact,
  type WebTaskAccepted,
} from '../contracts/web.js';
import type { TaskService } from '../tasks/task-service.js';
import type { ResumeDeletionService } from './resume-deletion-service.js';

/** Keeps destructive execution in Worker while exposing a stable preview/confirm protocol. */
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

  public preview(resumeDocumentId: string): WebResumeDeletionImpact {
    const result = this.#deletion.preview(resumeDocumentId);
    return webResumeDeletionImpactSchema.parse({
      resumeDocumentId,
      impactHash: result.impactHash,
      counts: result.counts,
      warnings: ['删除不可撤销；画像、匹配结果和独占 Agent 运行可能一并删除。'],
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
