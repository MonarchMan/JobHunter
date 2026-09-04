import { getWebContainer } from '../../../../../src/server/container.js';
import { dataResponse } from '../../../../../src/server/http.js';
import { interviewErrorResponse } from '../../../../../src/server/interview-http.js';

export const dynamic = 'force-dynamic';

/** 处理 Web API 的 GET 请求，读取并返回对应资源。 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    return dataResponse(
      (await getWebContainer()).services.experiences.get((await context.params).id),
    );
  } catch (error) {
    return interviewErrorResponse(error);
  }
}
