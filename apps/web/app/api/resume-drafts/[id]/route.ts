import { z } from 'zod';
import { resumeDocumentContentSchema } from '@jobhunter/resume-template';
import { getWebContainer } from '../../../../src/server/container.js';
import { verifyMutationRequest } from '../../../../src/server/csrf.js';
import { dataResponse, forbiddenResponse } from '../../../../src/server/http.js';
import { resumeErrorResponse } from '../../../../src/server/resume-http.js';

interface RouteContext {
  readonly params: Promise<{ readonly id: string }>;
}
const saveSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    content: resumeDocumentContentSchema,
  })
  .strict();

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  try {
    const { id } = await context.params;
    const container = await getWebContainer();
    return dataResponse(await container.services.resumeTemplates.detail(id));
  } catch (error) {
    return resumeErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  if (!verifyMutationRequest(request)) return forbiddenResponse();
  try {
    const { id } = await context.params;
    const input = saveSchema.parse(await request.json());
    const container = await getWebContainer();
    return dataResponse(
      await container.services.resumeTemplates.save(id, input.expectedRevision, input.content),
    );
  } catch (error) {
    return resumeErrorResponse(error);
  }
}
