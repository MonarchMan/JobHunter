import { dataResponse } from '../../../src/server/http.js';
import { getWebContainer } from '../../../src/server/container.js';
import { resumeErrorResponse } from '../../../src/server/resume-http.js';

export async function GET(): Promise<Response> {
  try {
    const container = await getWebContainer();
    return dataResponse(container.services.resumeTemplates.listTemplates());
  } catch (error) {
    return resumeErrorResponse(error);
  }
}
