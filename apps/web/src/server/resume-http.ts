import { ResumeDraftConflictError, ResumeTemplateNotFoundError } from '@jobhunter/application/web';
import { ZodError } from 'zod';
import { badRequestResponse, conflictResponse, errorResponse, notFoundResponse } from './http.js';

export function resumeErrorResponse(error: unknown): Response {
  if (error instanceof ResumeDraftConflictError) {
    return conflictResponse('RESUME_DRAFT_CONFLICT', error.message, {
      currentRevision: error.currentRevision,
    });
  }
  if (error instanceof ResumeTemplateNotFoundError) return notFoundResponse(error.message);
  if (error instanceof ZodError || error instanceof TypeError) {
    return badRequestResponse(error instanceof TypeError ? error.message : '简历制作请求无效。');
  }
  return errorResponse(error);
}
