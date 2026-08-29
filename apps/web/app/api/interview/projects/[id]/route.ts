import { getWebContainer } from '../../../../../src/server/container.js';
import { dataResponse } from '../../../../../src/server/http.js';
import { interviewErrorResponse } from '../../../../../src/server/interview-http.js';

interface RouteContext {
  readonly params: Promise<{ readonly id: string }>;
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  try {
    const { id } = await context.params;
    const container = await getWebContainer();
    return dataResponse(container.services.interview.getDossier(id));
  } catch (error) {
    return interviewErrorResponse(error);
  }
}
