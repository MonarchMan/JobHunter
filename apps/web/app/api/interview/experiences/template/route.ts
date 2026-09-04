import { getWebContainer } from '../../../../../src/server/container.js';
import { errorResponse } from '../../../../../src/server/http.js';

export const dynamic = 'force-dynamic';

/** 处理 Web API 的 GET 请求，读取并返回对应资源。 */
export async function GET(): Promise<Response> {
  try {
    const template = (await getWebContainer()).services.experiences.template();
    return new Response(template.markdown, {
      headers: {
        'content-type': template.mediaType,
        'content-disposition': `attachment; filename="${template.fileName}"`,
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
