import { getWebContainer } from '../../../../../src/server/container.js';
import { dataResponse } from '../../../../../src/server/http.js';
import { interviewErrorResponse } from '../../../../../src/server/interview-http.js';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  try {
    return dataResponse((await getWebContainer()).services.research.get((await context.params).id));
  } catch (error) {
    return interviewErrorResponse(error);
  }
}
