import { SourceSyncTargetRequiredError, webSourceMutationSchema } from '@jobhunter/application/web';
import { ZodError } from 'zod';
import {
  badRequestResponse,
  dataResponse,
  errorResponse,
  forbiddenResponse,
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
    const mutation = webSourceMutationSchema.parse({
      kind: 'sync',
      sourceId: id,
      idempotencyToken: body.idempotencyToken,
    });
    const container = await getWebContainer();
    return dataResponse(container.services.webSources.mutate(mutation), { status: 202 });
  } catch (error) {
    if (error instanceof SourceSyncTargetRequiredError) return badRequestResponse(error.message);
    if (error instanceof ZodError || error instanceof TypeError)
      return badRequestResponse('无法创建同步任务。');
    return errorResponse(error);
  }
}
