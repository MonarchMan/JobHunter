import { getWebContainer } from '../../../../../src/server/container.js';
import { dataResponse } from '../../../../../src/server/http.js';
import { interviewErrorResponse } from '../../../../../src/server/interview-http.js';

/** 模块数据结构或契约。 */
interface RouteContext {
  readonly params: Promise<{ readonly id: string }>;
}

/** 处理 Web API 的 GET 请求，读取并返回对应资源。 */
export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  try {
    const { id } = await context.params;
    const container = await getWebContainer();
    return dataResponse(container.services.interview.getDossier(id));
  } catch (error) {
    return interviewErrorResponse(error);
  }
}
