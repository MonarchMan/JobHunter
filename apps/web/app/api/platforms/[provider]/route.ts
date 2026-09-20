import { ZodError } from 'zod';
import { getWebContainer } from '../../../../src/server/container.js';
import { verifyMutationRequest } from '../../../../src/server/csrf.js';
import {
  badRequestResponse,
  dataResponse,
  errorResponse,
  forbiddenResponse,
} from '../../../../src/server/http.js';

/** 只读取本地任务状态，轮询不产生平台请求。 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ provider: string }> },
): Promise<Response> {
  const { provider } = await context.params;
  if (
    provider !== 'boss' &&
    provider !== 'zhilian' &&
    provider !== '51job' &&
    provider !== 'liepin'
  )
    return new Response(null, { status: 404 });
  try {
    return dataResponse((await getWebContainer()).services[provider].snapshot(), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/** 同源用户动作发布单次后台任务。 */
export async function POST(
  request: Request,
  context: { params: Promise<{ provider: string }> },
): Promise<Response> {
  if (!verifyMutationRequest(request)) return forbiddenResponse();
  const { provider } = await context.params;
  if (
    provider !== 'boss' &&
    provider !== 'zhilian' &&
    provider !== '51job' &&
    provider !== 'liepin'
  )
    return new Response(null, { status: 404 });
  try {
    return dataResponse((await getWebContainer()).services[provider].mutate(await request.json()), {
      status: 202,
    });
  } catch (error) {
    if (error instanceof ZodError || error instanceof TypeError || error instanceof SyntaxError)
      return badRequestResponse('平台操作参数无效。');
    return errorResponse(error);
  }
}
