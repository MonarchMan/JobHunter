import { JobNotFoundError } from '@jobhunter/application/web';
import { ZodError } from 'zod';
import {
  badRequestResponse,
  dataResponse,
  errorResponse,
  notFoundResponse,
} from '../../../../src/server/http.js';
import { getWebContainer } from '../../../../src/server/container.js';

export const dynamic = 'force-dynamic';

/** 模块数据结构或契约。 */
interface RouteContext {
  readonly params: Promise<{ readonly id: string }>;
}

/** 处理 Web API 的 GET 请求，读取并返回对应资源。 */
export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { id } = await context.params;
    const profile = new URL(request.url).searchParams.get('profile') ?? undefined;
    const container = await getWebContainer();
    return dataResponse(container.services.webJobDetails.get(id, profile));
  } catch (error) {
    if (error instanceof JobNotFoundError) return notFoundResponse('职位不存在。');
    if (error instanceof ZodError || error instanceof TypeError) return badRequestResponse();
    return errorResponse(error);
  }
}
