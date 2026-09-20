import { ZodError } from 'zod';
import { getWebContainer } from '../../../../../src/server/container.js';
import { verifyMutationRequest } from '../../../../../src/server/csrf.js';
import {
  badRequestResponse,
  dataResponse,
  errorResponse,
  forbiddenResponse,
} from '../../../../../src/server/http.js';

/** 可见详情页的显式 POST；GET 和预取不会触发交互写入。 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  // 1、同源 CSRF 校验；2、服务端时间原子更新，不入队、不请求平台。
  if (!verifyMutationRequest(request)) return forbiddenResponse();
  try {
    return dataResponse(
      (await getWebContainer()).services.platformActivity.touch((await context.params).id),
    );
  } catch (error) {
    if (error instanceof ZodError) return badRequestResponse('职位标识无效。');
    return errorResponse(error);
  }
}
