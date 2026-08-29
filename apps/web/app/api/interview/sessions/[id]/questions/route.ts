import { getWebContainer } from '../../../../../../src/server/container.js';
import { verifyMutationRequest } from '../../../../../../src/server/csrf.js';
import { dataResponse, forbiddenResponse } from '../../../../../../src/server/http.js';
import {
  interviewErrorResponse,
  presentInterviewTask,
} from '../../../../../../src/server/interview-http.js';

interface RouteContext {
  readonly params: Promise<{ readonly id: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  if (!verifyMutationRequest(request)) return forbiddenResponse();
  try {
    const { id } = await context.params;
    const container = await getWebContainer();
    return dataResponse(presentInterviewTask(container.services.interview.requestQuestion(id)), {
      status: 202,
    });
  } catch (error) {
    return interviewErrorResponse(error);
  }
}
