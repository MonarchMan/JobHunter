import {
  SourceSyncTargetRequiredError,
  webSourceChannelMutationSchema,
} from '@jobhunter/application/web';
import { ZodError } from 'zod';
import {
  badRequestResponse,
  dataResponse,
  errorResponse,
  forbiddenResponse,
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
    const body = (await request.json()) as Readonly<Record<string, unknown>>;
    const mutation = webSourceChannelMutationSchema.parse({
      kind: 'sync',
      channelId: id,
      idempotencyToken: body.idempotencyToken,
    });
    const container = await getWebContainer();
    return dataResponse(container.services.webSources.mutateChannel(mutation), { status: 202 });
  } catch (error) {
    if (error instanceof SourceSyncTargetRequiredError) return badRequestResponse(error.message);
    if (error instanceof ZodError || error instanceof TypeError)
      return badRequestResponse('无法创建渠道同步任务。');
    return errorResponse(error);
  }
}
