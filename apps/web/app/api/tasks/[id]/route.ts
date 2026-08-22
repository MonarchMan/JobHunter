import { getWebContainer } from '../../../../src/server/container.js';
import { dataResponse, errorResponse, notFoundResponse } from '../../../../src/server/http.js';

interface RouteContext {
  readonly params: Promise<{ readonly id: string }>;
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  try {
    const { id } = await context.params;
    const container = await getWebContainer();
    const task = container.services.diagnostics.getTask(id);
    return task ? dataResponse(task) : notFoundResponse('任务不存在。');
  } catch (error) {
    if (error instanceof TypeError) return notFoundResponse('任务不存在。');
    return errorResponse(error);
  }
}
