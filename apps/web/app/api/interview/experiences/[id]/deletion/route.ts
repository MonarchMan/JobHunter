import { webDeleteExperienceSchema } from '@jobhunter/application/web';
import { getWebContainer } from '../../../../../../src/server/container.js';
import { dataResponse, forbiddenResponse } from '../../../../../../src/server/http.js';
import { verifyMutationRequest } from '../../../../../../src/server/csrf.js';
import { interviewErrorResponse } from '../../../../../../src/server/interview-http.js';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    return dataResponse(
      (await getWebContainer()).services.experiences.previewDeletion((await context.params).id),
    );
  } catch (error) {
    return interviewErrorResponse(error);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (!verifyMutationRequest(request)) return forbiddenResponse();
  try {
    const body = webDeleteExperienceSchema.parse(await request.json());
    return dataResponse(
      await (
        await getWebContainer()
      ).services.experiences.deleteConfirmed({
        documentId: (await context.params).id,
        expectedImpactHash: body.expectedImpactHash,
      }),
    );
  } catch (error) {
    return interviewErrorResponse(error);
  }
}
