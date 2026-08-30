import { getWebContainer } from '../../../../../../src/server/container.js';
import { verifyMutationRequest } from '../../../../../../src/server/csrf.js';
import { dataResponse, forbiddenResponse } from '../../../../../../src/server/http.js';
import { interviewErrorResponse } from '../../../../../../src/server/interview-http.js';
import { webStartDrillSessionSchema } from '@jobhunter/application/web';

interface RouteContext {
  readonly params: Promise<{ readonly id: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  if (!verifyMutationRequest(request)) return forbiddenResponse();
  try {
    const { id } = await context.params;
    const container = await getWebContainer();
    const contentType = request.headers.get('content-type') ?? '';
    const body = webStartDrillSessionSchema.parse(
      contentType.includes('application/json') ? await request.json() : {},
    );
    return dataResponse(container.services.interview.startSession(id, body), { status: 201 });
  } catch (error) {
    return interviewErrorResponse(error);
  }
}
