import type { ResumePolishSuggestionStore } from '../ports/resume-polish.js';
import { parseId, type IdGenerator } from '@jobhunter/common/domain';
import {
  resumePolishAgentOutputSchema,
  resumePolishSectionSchema,
  type ResumePolishSection,
} from '@jobhunter/user/polish';
import type { CandidateProfileRepository } from '@jobhunter/user/ports/profiles';
import {
  webResumePolishAcceptedSchema,
  webResumePolishStatusSchema,
  type WebResumePolishAccepted,
  type WebResumePolishStatus,
} from '@jobhunter/user/contracts/web';
import type { TaskService } from '@jobhunter/common/tasks';

/** 润色请求不满足当前画像或幂等约束时抛出的应用错误。 */
export class ResumePolishValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ResumePolishValidationError';
  }
}

/** 将任务错误分类转换为不泄露内部细节的用户提示。 */
function presentTaskError(category: string | null): string {
  switch (category) {
    case 'invalid_config':
      return 'AI 模型尚未配置，请先完成模型配置后重试。';
    case 'rate_limited':
      return 'AI 服务当前请求较多，请稍后重试。';
    case 'network_temporary':
    case 'upstream_5xx':
      return 'AI 服务暂时不可用，请稍后重试。';
    case 'validation_failed':
      return 'AI 返回的润色内容未通过校验，请重新生成。';
    case 'cancelled':
      return 'AI 润色任务已取消。';
    default:
      return 'AI 润色失败，请稍后重试。';
  }
}

/** 创建润色任务并从业务仓储读取用户可选择应用的建议。 */
export class ResumePolishService {
  readonly #profiles: CandidateProfileRepository;
  readonly #suggestions: ResumePolishSuggestionStore;
  readonly #tasks: TaskService;
  readonly #ids: IdGenerator;

  /** 执行应用组件对外暴露的操作。 */
  public constructor(input: {
    readonly profiles: CandidateProfileRepository;
    readonly suggestions: ResumePolishSuggestionStore;
    readonly tasks: TaskService;
    readonly ids: IdGenerator;
  }) {
    this.#profiles = input.profiles;
    this.#suggestions = input.suggestions;
    this.#tasks = input.tasks;
    this.#ids = input.ids;
  }

  /** 执行应用组件对外暴露的操作。 */
  public enqueue(input: {
    readonly profileId: string;
    readonly sourceVersionId: string;
    readonly sections: readonly ResumePolishSection[];
    readonly idempotencyToken: string;
  }): WebResumePolishAccepted {
    // 1、校验画像版本仍是当前版本，并确认目标岗位和选中章节可润色。
    const profileId = parseId(input.profileId, 'CandidateProfile');
    const sourceVersionId = parseId(input.sourceVersionId, 'ProfileVersion');
    const version = this.#profiles.getVersion(sourceVersionId);
    const current = this.#profiles.getCurrentVersion(profileId);
    if (version?.profileId !== profileId || current?.id !== version.id) {
      throw new ResumePolishValidationError('在线简历已更新，请刷新后重新生成润色建议。');
    }
    const sections = [
      ...new Set(input.sections.map((section) => resumePolishSectionSchema.parse(section))),
    ];
    if (sections.length === 0) {
      throw new ResumePolishValidationError('请至少选择一项需要润色的经历。');
    }
    if (version.effective.targetRoles.length === 0) {
      throw new ResumePolishValidationError('请先确认目标岗位，再生成润色建议。');
    }
    const hasContent = (section: ResumePolishSection): boolean =>
      version.effective[section].some((item) =>
        item.highlights.some((highlight) => highlight.trim()),
      );
    if (sections.some((section) => !hasContent(section))) {
      throw new ResumePolishValidationError('所选经历没有可润色的描述，请先补充内容。');
    }
    const idempotencyToken = input.idempotencyToken.trim();
    if (idempotencyToken.length < 8) {
      throw new ResumePolishValidationError('润色请求标识无效，请重新提交。');
    }
    // 2、生成建议标识并以稳定幂等键入队，实际模型调用由 Worker 执行。
    const suggestionId = this.#ids.generate();
    const result = this.#tasks.enqueue({
      taskType: 'resume.polish',
      priority: 80,
      payload: { suggestionId, profileId, sourceVersionId, sections },
      idempotencyKey: `resume.polish:${sourceVersionId}:${sections.toSorted().join(',')}:${idempotencyToken}`,
    });
    const payload = result.task.payload as { readonly suggestionId?: string };
    return webResumePolishAcceptedSchema.parse({
      suggestionId: payload.suggestionId ?? suggestionId,
      task: {
        taskId: result.task.id,
        status: result.task.status,
        deduplicated: result.kind !== 'enqueued',
        statusUrl: `/api/profile/polish?task=${result.task.id}&suggestion=${payload.suggestionId ?? suggestionId}`,
      },
    });
  }

  /** 查询润色任务状态，并读取业务仓储中经过 Schema 校验的建议。 */
  public status(taskIdValue: string, suggestionId: string): WebResumePolishStatus | null {
    const task = this.#tasks.get(parseId(taskIdValue, 'Task'));
    if (task?.taskType !== 'resume.polish') return null;
    const payload = task.payload as {
      readonly suggestionId?: string;
      readonly sourceVersionId?: string;
      readonly sections?: readonly ResumePolishSection[];
    };
    if (payload.suggestionId !== suggestionId) return null;
    const taskResult = task.status === 'succeeded' ? resumePolishTaskResult(task.result) : null;
    const output = taskResult ? this.#suggestions.get(suggestionId) : null;
    const suggestion =
      output !== null && payload.sourceVersionId && payload.sections
        ? {
            sourceVersionId: payload.sourceVersionId,
            sections: payload.sections,
            result: resumePolishAgentOutputSchema.parse(output),
          }
        : null;
    const resultUnavailable = task.status === 'succeeded' && suggestion === null;
    return webResumePolishStatusSchema.parse({
      suggestionId,
      status: resultUnavailable ? 'failed' : task.status,
      errorSummary: resultUnavailable
        ? '润色建议不可用，请重新生成。'
        : task.status === 'failed' || task.status === 'cancelled'
          ? presentTaskError(task.errorCategory)
          : null,
      suggestion: suggestion
        ? {
            ...suggestion,
          }
        : null,
    });
  }
}

/** 从通用任务结果中提取润色 Agent 运行 ID。 */
function resumePolishTaskResult(value: unknown): { readonly agentRunId: string } | null {
  if (!value || typeof value !== 'object' || !('agentRunId' in value)) return null;
  const agentRunId = value.agentRunId;
  return typeof agentRunId === 'string' ? { agentRunId } : null;
}
