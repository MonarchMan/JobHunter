import { webAcceptExperienceSchema } from '@jobhunter/application/web';
import { getWebContainer } from '../../../../../../src/server/container.js';
import { dataResponse, forbiddenResponse } from '../../../../../../src/server/http.js';
import { verifyMutationRequest } from '../../../../../../src/server/csrf.js';
import { interviewErrorResponse } from '../../../../../../src/server/interview-http.js';

export const dynamic = 'force-dynamic';

/** 处理 Web API 的 POST 请求，校验输入并提交业务操作。 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (!verifyMutationRequest(request)) return forbiddenResponse();
  try {
    const body = webAcceptExperienceSchema.parse(await request.json());
    return dataResponse(
      (await getWebContainer()).services.experiences.accept({
        documentId: (await context.params).id,
        ...body,
      }),
    );
  } catch (error) {
    return interviewErrorResponse(error);
  }
}
