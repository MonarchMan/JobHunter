import {
  DrillSessionNotFoundError,
  InterviewProjectConflictError,
  ProjectDossierNotFoundError,
  type InterviewTaskAccepted,
} from '@jobhunter/application/web';
import { DomainError } from '@jobhunter/domain';
import { ZodError } from 'zod';
import { badRequestResponse, conflictResponse, errorResponse, notFoundResponse } from './http.js';

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

export function interviewErrorResponse(error: unknown): Response {
  if (error instanceof ProjectDossierNotFoundError) {
    return notFoundResponse('项目拷打档案不存在。');
  }
  if (error instanceof DrillSessionNotFoundError) {
    return notFoundResponse('项目拷打会话不存在。');
  }
  if (error instanceof InterviewProjectConflictError) {
    return conflictResponse('INTERVIEW_STATE_CHANGED', '拷打状态已变化，请刷新后重试。', {});
  }
  if (error instanceof DomainError) {
    return conflictResponse('INTERVIEW_STATE_CHANGED', '当前状态不允许该操作，请刷新后重试。', {});
  }
  if (error instanceof ZodError || error instanceof TypeError) {
    return badRequestResponse('项目拷打请求无效。');
  }
  return errorResponse(error);
}
