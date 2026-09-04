import { getWebContainer } from '../../../../../../src/server/container.js';
import { interviewErrorResponse } from '../../../../../../src/server/interview-http.js';

export const dynamic = 'force-dynamic';

/** 处理 Web API 的 GET 请求，读取并返回对应资源。 */
export async function GET(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  try {
    const { id } = await context.params;
    const prompt = await (await getWebContainer()).services.research.prompt(id, request.signal);
    return new Response(prompt, {
      headers: {
        'content-type': 'text/markdown; charset=utf-8',
        'content-disposition': `attachment; filename="community-research-${id}.md"`,
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    return interviewErrorResponse(error);
  }
}
