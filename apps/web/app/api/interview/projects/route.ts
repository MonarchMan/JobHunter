import { webCreateProjectDossierSchema } from '@jobhunter/application/web';
import { getWebContainer } from '../../../../src/server/container.js';
import { verifyMutationRequest } from '../../../../src/server/csrf.js';
import { dataResponse, forbiddenResponse } from '../../../../src/server/http.js';
import { interviewErrorResponse } from '../../../../src/server/interview-http.js';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  try {
    const container = await getWebContainer();
    return dataResponse({
      availableProjects: container.services.interview.listAvailableProjects(),
      dossiers: container.services.interview.listDossiers(),
    });
  } catch (error) {
    return interviewErrorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!verifyMutationRequest(request)) return forbiddenResponse();
  try {
    const input = webCreateProjectDossierSchema.parse(await request.json());
    const container = await getWebContainer();
    return dataResponse(container.services.interview.createDossier(input), { status: 201 });
  } catch (error) {
    return interviewErrorResponse(error);
  }
}
