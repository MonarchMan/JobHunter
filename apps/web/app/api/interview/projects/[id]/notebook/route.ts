import { getWebContainer } from '../../../../../../src/server/container.js';
import { interviewErrorResponse } from '../../../../../../src/server/interview-http.js';

/** 模块数据结构或契约。 */
interface RouteContext {
  readonly params: Promise<{ readonly id: string }>;
}

/** 处理 Web API 的 GET 请求，读取并返回对应资源。 */
export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { id } = await context.params;
    const container = await getWebContainer();
    const notebook = await container.services.interview.readNotebook(id, request.signal);
    return new Response(Uint8Array.from(notebook.content).buffer, {
      headers: {
        'cache-control': 'no-store',
        'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(notebook.filename)}`,
        'content-type': notebook.mediaType,
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    return interviewErrorResponse(error);
  }
}
