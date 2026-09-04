import { webJobMatchMutationSchema } from '@jobhunter/application/web';
import { ZodError } from 'zod';
import { getWebContainer } from '../../../../../src/server/container.js';
import {
  badRequestResponse,
  dataResponse,
  errorResponse,
  forbiddenResponse,
} from '../../../../../src/server/http.js';
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
    const body = webJobMatchMutationSchema.parse((await request.json()) as unknown);
    const container = await getWebContainer();
    return dataResponse(
      container.services.matches.runForJob({
        jobId: id,
        ...(body.profileVersionId ? { profileVersionId: body.profileVersionId } : {}),
        ...(body.idempotencyToken ? { idempotencyToken: body.idempotencyToken } : {}),
        mode: body.mode,
      }),
      { status: 202 },
    );
  } catch (error) {
    if (error instanceof ZodError || error instanceof TypeError) {
      return badRequestResponse('职位评分请求无效。');
    }
    return errorResponse(error);
  }
}
