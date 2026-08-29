import { webDeleteProjectDossierSchema } from '@jobhunter/application/web';
import { getWebContainer } from '../../../../../../src/server/container.js';
import { verifyMutationRequest } from '../../../../../../src/server/csrf.js';
import { dataResponse, forbiddenResponse } from '../../../../../../src/server/http.js';
import { interviewErrorResponse } from '../../../../../../src/server/interview-http.js';

interface RouteContext {
  readonly params: Promise<{ readonly id: string }>;
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  try {
    const { id } = await context.params;
    const container = await getWebContainer();
    return dataResponse(container.services.interview.previewDeletion(id));
  } catch (error) {
    return interviewErrorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  if (!verifyMutationRequest(request)) return forbiddenResponse();
  try {
    const { id } = await context.params;
    const body = webDeleteProjectDossierSchema.parse(await request.json());
    const container = await getWebContainer();
    return dataResponse(
      await container.services.interview.deleteConfirmed({
        dossierId: id,
        expectedImpactHash: body.expectedImpactHash,
      }),
    );
  } catch (error) {
    return interviewErrorResponse(error);
  }
}
