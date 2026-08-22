import { getWebContainer } from '../../../../src/server/container.js';
import { dataResponse, errorResponse, notFoundResponse } from '../../../../src/server/http.js';

interface RouteContext {
  readonly params: Promise<{ readonly id: string }>;
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  try {
    const { id } = await context.params;
    const container = await getWebContainer();
    const run = container.services.diagnostics.getAgentRun(id);
    return run ? dataResponse(run) : notFoundResponse('Agent 运行不存在。');
  } catch (error) {
    return errorResponse(error);
  }
}
