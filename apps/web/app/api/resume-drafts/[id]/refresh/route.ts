import { z } from 'zod';
import { getWebContainer } from '../../../../../src/server/container.js';
import { verifyMutationRequest } from '../../../../../src/server/csrf.js';
import { dataResponse, forbiddenResponse } from '../../../../../src/server/http.js';
import { resumeErrorResponse } from '../../../../../src/server/resume-http.js';

interface RouteContext {
  readonly params: Promise<{ readonly id: string }>;
}
const refreshSchema = z.object({ expectedRevision: z.number().int().nonnegative() }).strict();

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  if (!verifyMutationRequest(request)) return forbiddenResponse();
  try {
    const { id } = await context.params;
    const input = refreshSchema.parse(await request.json());
    const container = await getWebContainer();
    return dataResponse(
      await container.services.resumeTemplates.refresh(id, input.expectedRevision),
    );
  } catch (error) {
    return resumeErrorResponse(error);
  }
}
