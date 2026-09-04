import {
  DrillSessionNotFoundError,
  ExperienceDocumentConflictError,
  ExperienceDocumentNotFoundError,
  ExperienceDocumentParseError,
  ExperienceResearchBundleError,
  ExperienceResearchConflictError,
  ExperienceResearchNotFoundError,
  InterviewProjectConflictError,
  ProjectMaterialError,
  ProjectDossierNotFoundError,
  TaskExecutionError,
  type InterviewTaskAccepted,
} from '@jobhunter/application/web';
import { DomainError } from '@jobhunter/domain';
import { ZodError } from 'zod';
import {
  badRequestResponse,
  conflictResponse,
  errorResponse,
  notFoundResponse,
  serviceUnavailableResponse,
} from './http.js';

/** 将应用层任务入队结果转换为 HTTP 响应载荷。 */
export function presentInterviewTask(result: InterviewTaskAccepted): {
  readonly taskId: string;
  readonly status: string;
  readonly deduplicated: boolean;
  readonly statusUrl: string;
} {
  return {
    taskId: result.task.id,
    status: result.task.status,
    deduplicated: result.deduplicated,
    statusUrl: `/api/tasks/${result.task.id}`,
  };
}

/** 将面试准备领域错误映射为稳定的 HTTP 状态和消息。 */
export function interviewErrorResponse(error: unknown): Response {
  if (error instanceof ProjectDossierNotFoundError) {
    return notFoundResponse('项目拷打档案不存在。');
  }
  if (error instanceof DrillSessionNotFoundError) {
    return notFoundResponse('项目拷打会话不存在。');
  }
  if (error instanceof ExperienceDocumentNotFoundError) {
    return notFoundResponse('个人面经文档不存在。');
  }
  if (error instanceof ExperienceDocumentConflictError) {
    return conflictResponse('EXPERIENCE_CHANGED', '面经草稿已变化，请刷新后重新核对。', {});
  }
  if (error instanceof ExperienceDocumentParseError) {
    return badRequestResponse(error.message);
  }
  if (error instanceof ExperienceResearchNotFoundError) {
    return notFoundResponse('网友面经研究请求不存在。');
  }
  if (error instanceof ExperienceResearchConflictError) {
    return conflictResponse('RESEARCH_CHANGED', error.message, {});
  }
  if (error instanceof ExperienceResearchBundleError || error instanceof ProjectMaterialError) {
    return badRequestResponse(error.message);
  }
  if (error instanceof InterviewProjectConflictError) {
    return conflictResponse('INTERVIEW_STATE_CHANGED', '拷打状态已变化，请刷新后重试。', {});
  }
  if (error instanceof TaskExecutionError) {
    if (error.category === 'validation_failed') {
      return badRequestResponse('模型返回的问题未通过安全校验，请重新生成。');
    }
    if (error.category === 'cancelled') {
      return conflictResponse('QUESTION_CANCELLED', '问题生成已取消，可以重新生成。', {});
    }
    return serviceUnavailableResponse(
      error.category === 'invalid_config'
        ? 'AI 模型尚未配置，暂时无法生成问题。'
        : 'AI 模型暂时不可用，请稍后重试。',
    );
  }
  if (error instanceof DOMException && error.name === 'AbortError') {
    return conflictResponse('QUESTION_CANCELLED', '问题生成已取消，可以重新生成。', {});
  }
  if (error instanceof DomainError) {
    if (error.code === 'INVALID_EXPERIENCE_TEXT') {
      return badRequestResponse('面经文档没有可整理的文本，请检查内容。');
    }
    if (error.code === 'EXPERIENCE_HAS_NO_QUESTIONS') {
      return badRequestResponse('至少需要保留一个非空问题，才能接受为历史面经。');
    }
    return conflictResponse('INTERVIEW_STATE_CHANGED', '当前状态不允许该操作，请刷新后重试。', {});
  }
  if (error instanceof ZodError || error instanceof TypeError) {
    return badRequestResponse('面试准备请求无效，请检查填写内容。');
  }
  return errorResponse(error);
}
