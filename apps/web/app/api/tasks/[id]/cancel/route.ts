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

/** 模块数据结构或契约。 */
interface RouteContext {
  readonly params: Promise<{ readonly id: string }>;
}

/** 处理 Web API 的 POST 请求，校验输入并提交业务操作。 */
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  if (!verifyMutationRequest(request)) return forbiddenResponse();
  try {
    const { id } = await context.params;
    const mutation = webTaskMutationSchema.parse({ kind: 'cancel', taskId: id });
    const container = await getWebContainer();
    const result = container.services.diagnostics.mutate(mutation);
    if (result.kind === 'not_found') return notFoundResponse('任务不存在。');
    return dataResponse(result);
  } catch (error) {
    if (error instanceof ZodError || error instanceof TypeError)
      return badRequestResponse('无法取消该任务。');
    return errorResponse(error);
  }
}
