import { webReviewExperienceResearchSchema } from '@jobhunter/application/web';
import { getWebContainer } from '../../../../../../src/server/container.js';
import { verifyMutationRequest } from '../../../../../../src/server/csrf.js';
import { dataResponse, forbiddenResponse } from '../../../../../../src/server/http.js';
import { interviewErrorResponse } from '../../../../../../src/server/interview-http.js';

export async function POST(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  if (!verifyMutationRequest(request)) return forbiddenResponse();
  try {
    const input = webReviewExperienceResearchSchema.parse(await request.json());
    const detail = (await getWebContainer()).services.research.review({
      requestId: (await context.params).id,
      ...input,
    });
    return dataResponse(detail);
  } catch (error) {
    return interviewErrorResponse(error);
  }
}
