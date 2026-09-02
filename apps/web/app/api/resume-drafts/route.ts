import { z } from 'zod';
import { resumeTemplateKeySchema } from '@jobhunter/resume-template';
import { getWebContainer } from '../../../src/server/container.js';
import { verifyMutationRequest } from '../../../src/server/csrf.js';
import { dataResponse, forbiddenResponse } from '../../../src/server/http.js';
import { resumeErrorResponse } from '../../../src/server/resume-http.js';

const createSchema = z
  .object({ profileId: z.string().min(1), templateKey: resumeTemplateKeySchema })
  .strict();

export async function POST(request: Request): Promise<Response> {
  if (!verifyMutationRequest(request)) return forbiddenResponse();
  try {
    const input = createSchema.parse(await request.json());
    const container = await getWebContainer();
    return dataResponse(
      await container.services.resumeTemplates.createOrResume(input.profileId, input.templateKey),
      { status: 201 },
    );
  } catch (error) {
    return resumeErrorResponse(error);
  }
}
