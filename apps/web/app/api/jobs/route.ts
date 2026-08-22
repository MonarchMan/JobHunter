import { ZodError } from 'zod';
import { badRequestResponse, dataResponse, errorResponse } from '../../../src/server/http.js';
import { parseWebJobQuery, queryRecord } from '../../../src/server/job-query.js';
import { getWebContainer } from '../../../src/server/container.js';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  try {
    const query = parseWebJobQuery(queryRecord(new URL(request.url).searchParams));
    const container = await getWebContainer();
    return dataResponse(container.services.webJobs.list(query));
  } catch (error) {
    if (error instanceof ZodError || error instanceof TypeError) return badRequestResponse();
    return errorResponse(error);
  }
}
