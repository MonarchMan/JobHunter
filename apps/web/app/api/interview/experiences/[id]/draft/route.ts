import { webReplaceExperienceDraftSchema } from '@jobhunter/application/web';
import { getWebContainer } from '../../../../../../src/server/container.js';
import { dataResponse, forbiddenResponse } from '../../../../../../src/server/http.js';
import { verifyMutationRequest } from '../../../../../../src/server/csrf.js';
import { interviewErrorResponse } from '../../../../../../src/server/interview-http.js';

export const dynamic = 'force-dynamic';

/** 处理 Web API 的 PUT 请求，校验输入并替换资源。 */
export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (!verifyMutationRequest(request)) return forbiddenResponse();
  try {
    const body = webReplaceExperienceDraftSchema.parse(await request.json());
    return dataResponse(
      (await getWebContainer()).services.experiences.replaceDraft({
        documentId: (await context.params).id,
        ...body,
      }),
    );
  } catch (error) {
    return interviewErrorResponse(error);
  }
}
