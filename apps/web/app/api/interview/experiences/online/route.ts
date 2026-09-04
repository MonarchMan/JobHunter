import { webCreateOnlineExperienceSchema } from '@jobhunter/application/web';
import { forbiddenResponse, dataResponse } from '../../../../../src/server/http.js';
import { getWebContainer } from '../../../../../src/server/container.js';
import { verifyMutationRequest } from '../../../../../src/server/csrf.js';
import { interviewErrorResponse } from '../../../../../src/server/interview-http.js';

export const dynamic = 'force-dynamic';

/** 处理 Web API 的 POST 请求，校验输入并提交业务操作。 */
export async function POST(request: Request): Promise<Response> {
  if (!verifyMutationRequest(request)) return forbiddenResponse();
  try {
    const draft = webCreateOnlineExperienceSchema.parse(await request.json());
    const result = await (
      await getWebContainer()
    ).services.experiences.createOnline(draft, request.signal);
    return dataResponse(
      { documentId: result.detail.document.id, deduplicated: result.deduplicated },
      { status: result.deduplicated ? 200 : 201 },
    );
  } catch (error) {
    return interviewErrorResponse(error);
  }
}
