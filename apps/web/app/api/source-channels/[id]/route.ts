import { webSourceChannelMutationSchema } from '@jobhunter/application/web';
import { ZodError } from 'zod';
import {
  badRequestResponse,
  dataResponse,
  errorResponse,
  forbiddenResponse,
} from '../../../../src/server/http.js';
import { getWebContainer } from '../../../../src/server/container.js';
import { verifyMutationRequest } from '../../../../src/server/csrf.js';

interface RouteContext {
  readonly params: Promise<{ readonly id: string }>;
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  if (!verifyMutationRequest(request)) return forbiddenResponse();
  try {
    const { id } = await context.params;
    const body = (await request.json()) as Readonly<Record<string, unknown>>;
    const mutation = webSourceChannelMutationSchema.parse({ ...body, channelId: id });
    const container = await getWebContainer();
    return dataResponse(container.services.webSources.mutateChannel(mutation));
  } catch (error) {
    if (error instanceof ZodError || error instanceof TypeError)
      return badRequestResponse('渠道设置无效。');
    return errorResponse(error);
  }
}
