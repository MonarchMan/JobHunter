import {
  webCommunityExperienceFilterSchema,
  webCreateExperienceResearchSchema,
} from '@jobhunter/application/web';
import { getWebContainer } from '../../../../src/server/container.js';
import { verifyMutationRequest } from '../../../../src/server/csrf.js';
import { dataResponse, forbiddenResponse } from '../../../../src/server/http.js';
import { interviewErrorResponse } from '../../../../src/server/interview-http.js';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  try {
    const service = (await getWebContainer()).services.research;
    const search = new URL(request.url).searchParams;
    const filter = webCommunityExperienceFilterSchema.parse({
      ...(search.get('company') ? { company: search.get('company') } : {}),
      ...(search.get('role') ? { role: search.get('role') } : {}),
      ...(search.get('stage') ? { stage: search.get('stage') } : {}),
    });
    return dataResponse({
      requests: service.listRequests(),
      accepted: service.listAccepted(filter),
    });
  } catch (error) {
    return interviewErrorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!verifyMutationRequest(request)) return forbiddenResponse();
  try {
    const brief = webCreateExperienceResearchSchema.parse(await request.json());
    const result = await (await getWebContainer()).services.research.create(brief);
    return dataResponse(result, { status: result.deduplicated ? 200 : 201 });
  } catch (error) {
    return interviewErrorResponse(error);
  }
}
