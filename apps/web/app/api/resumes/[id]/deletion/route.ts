import {
  ResumeDeletionNotFoundError,
  webResumeDeletionConfirmSchema,
} from '@jobhunter/application/web';
import { ZodError } from 'zod';
import { getWebContainer } from '../../../../../src/server/container.js';
import { verifyMutationRequest } from '../../../../../src/server/csrf.js';
import {
  badRequestResponse,
  conflictResponse,
  dataResponse,
  errorResponse,
  forbiddenResponse,
  notFoundResponse,
} from '../../../../../src/server/http.js';

interface RouteContext {
  readonly params: Promise<{ readonly id: string }>;
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  try {
    const { id } = await context.params;
    const container = await getWebContainer();
    return dataResponse(container.services.resumeDeletion.preview(id));
  } catch (error) {
    if (error instanceof ResumeDeletionNotFoundError) return notFoundResponse('简历不存在。');
    if (error instanceof ZodError || error instanceof TypeError)
      return badRequestResponse('简历 ID 无效。');
    return errorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  if (!verifyMutationRequest(request)) return forbiddenResponse();
  try {
    const { id } = await context.params;
    const body = (await request.json()) as Readonly<Record<string, unknown>>;
    const command = webResumeDeletionConfirmSchema.parse({ ...body, resumeDocumentId: id });
    const container = await getWebContainer();
    return dataResponse(container.services.resumeDeletion.confirm(command), { status: 202 });
  } catch (error) {
    if (error instanceof ResumeDeletionNotFoundError) return notFoundResponse('简历不存在。');
    if (error instanceof TypeError)
      return conflictResponse('DELETION_IMPACT_CHANGED', '删除影响已变化，请重新预览。', {});
    if (error instanceof ZodError) return badRequestResponse('删除确认信息无效。');
    return errorResponse(error);
  }
}
