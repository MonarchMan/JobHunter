import { getWebContainer } from '../../../../../../src/server/container.js';
import { dataResponse } from '../../../../../../src/server/http.js';
import { resumeErrorResponse } from '../../../../../../src/server/resume-http.js';

/** 模块数据结构或契约。 */
interface RouteContext {
  readonly params: Promise<{ readonly id: string; readonly requestId: string }>;
}

/** 处理 Web API 的 GET 请求，读取并返回对应资源。 */
export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  try {
    const { id, requestId } = await context.params;
    const container = await getWebContainer();
    return dataResponse(container.services.resumeTemplates.getExport(id, requestId), {
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error) {
    return resumeErrorResponse(error);
  }
}
