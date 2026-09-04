import { webDrillSessionStateSchema } from '@jobhunter/application/web';
import { getWebContainer } from '../../../../../../src/server/container.js';
import { verifyMutationRequest } from '../../../../../../src/server/csrf.js';
import { dataResponse, forbiddenResponse } from '../../../../../../src/server/http.js';
import { interviewErrorResponse } from '../../../../../../src/server/interview-http.js';

/** 模块数据结构或契约。 */
interface RouteContext {
  readonly params: Promise<{ readonly id: string }>;
}

/** 处理 Web API 的 POST 请求，校验输入并提交业务操作。 */
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  if (!verifyMutationRequest(request)) return forbiddenResponse();
  try {
    const { id } = await context.params;
    const body = webDrillSessionStateSchema.parse(await request.json());
    const container = await getWebContainer();
    container.services.interview.transitionSession({ sessionId: id, action: body.action });
    return dataResponse({
      status:
        body.action === 'complete' ? 'completed' : body.action === 'pause' ? 'paused' : 'active',
    });
  } catch (error) {
    return interviewErrorResponse(error);
  }
}
