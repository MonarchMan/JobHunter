import {
  ResumePolishValidationError,
  webResumePolishRequestSchema,
} from '@jobhunter/application/web';
import { ZodError } from 'zod';
import {
  badRequestResponse,
  dataResponse,
  errorResponse,
  forbiddenResponse,
  notFoundResponse,
} from '../../../../src/server/http.js';
import { getWebContainer } from '../../../../src/server/container.js';
import { verifyMutationRequest } from '../../../../src/server/csrf.js';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  if (!verifyMutationRequest(request)) return forbiddenResponse();
  try {
    const input = webResumePolishRequestSchema.parse(await request.json());
    const container = await getWebContainer();
    return dataResponse(container.services.resumePolish.enqueue(input), { status: 202 });
  } catch (error) {
    if (error instanceof ResumePolishValidationError) return badRequestResponse(error.message);
    if (error instanceof ZodError || error instanceof TypeError) {
      return badRequestResponse('润色请求无效，请检查目标岗位和所选经历。');
    }
    return errorResponse(error);
  }
}

export async function GET(request: Request): Promise<Response> {
  try {
    const parameters = new URL(request.url).searchParams;
    const taskId = parameters.get('task');
    const suggestionId = parameters.get('suggestion');
    if (!taskId || !suggestionId) return badRequestResponse('缺少润色任务标识。');
    const container = await getWebContainer();
    const status = container.services.resumePolish.status(taskId, suggestionId);
    return status ? dataResponse(status) : notFoundResponse('润色任务不存在。');
  } catch (error) {
    if (error instanceof TypeError) return notFoundResponse('润色任务不存在。');
    return errorResponse(error);
  }
}
