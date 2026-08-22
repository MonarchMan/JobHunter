import { webTaskMutationSchema } from '@jobhunter/application/web';
import { ZodError } from 'zod';
import {
  badRequestResponse,
  dataResponse,
  errorResponse,
  forbiddenResponse,
  notFoundResponse,
} from '../../../../../src/server/http.js';
import { getWebContainer } from '../../../../../src/server/container.js';
import { verifyMutationRequest } from '../../../../../src/server/csrf.js';

interface RouteContext {
  readonly params: Promise<{ readonly id: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  if (!verifyMutationRequest(request)) return forbiddenResponse();
  try {
    const { id } = await context.params;
    const body = (await request.json()) as Readonly<Record<string, unknown>>;
    const mutation = webTaskMutationSchema.parse({
      kind: 'retry',
      taskId: id,
      idempotencyToken: body.idempotencyToken,
    });
    const container = await getWebContainer();
    const result = container.services.diagnostics.mutate(mutation);
    if (result.kind === 'not_found') return notFoundResponse('任务不存在。');
    return dataResponse(result, { status: 202 });
  } catch (error) {
    if (error instanceof ZodError || error instanceof TypeError)
      return badRequestResponse('仅失败任务可以重试。');
    return errorResponse(error);
  }
}
