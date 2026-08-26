import { webJobBulkMatchMutationSchema } from '@jobhunter/application/web';
import { ZodError } from 'zod';
import { getWebContainer } from '../../../../src/server/container.js';
import {
  badRequestResponse,
  dataResponse,
  errorResponse,
  forbiddenResponse,
} from '../../../../src/server/http.js';
import { verifyMutationRequest } from '../../../../src/server/csrf.js';

export async function POST(request: Request): Promise<Response> {
  if (!verifyMutationRequest(request)) return forbiddenResponse();
  try {
    const body = webJobBulkMatchMutationSchema.parse((await request.json()) as unknown);
    const container = await getWebContainer();
    return dataResponse(
      container.services.matches.runForJobs({
        jobIds: body.jobIds,
        mode: body.mode,
        idempotencyToken: body.idempotencyToken,
        ...(body.profileVersionId ? { profileVersionId: body.profileVersionId } : {}),
      }),
      { status: 202 },
    );
  } catch (error) {
    if (error instanceof ZodError || error instanceof TypeError) {
      return badRequestResponse('职位批量评分请求无效。');
    }
    return errorResponse(error);
  }
}
