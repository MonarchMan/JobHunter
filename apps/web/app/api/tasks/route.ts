import { dataResponse, errorResponse } from '../../../src/server/http.js';
import { getWebContainer } from '../../../src/server/container.js';

export async function GET(request: Request): Promise<Response> {
  try {
    const search = new URL(request.url).searchParams;
    const page = Number(search.get('taskPage') ?? '1');
    const agentPage = Number(search.get('agentPage') ?? '1');
    const status = search.get('status');
    const taskType = search.get('type');
    const validStatuses = ['pending', 'running', 'failed', 'succeeded', 'cancelled'] as const;
    const container = await getWebContainer();
    return dataResponse(
      container.services.diagnostics.list({
        ...(validStatuses.includes(status as (typeof validStatuses)[number])
          ? { status: status as (typeof validStatuses)[number] }
          : {}),
        ...(taskType ? { taskType } : {}),
        taskPage: Number.isSafeInteger(page) && page > 0 ? page : 1,
        agentPage: Number.isSafeInteger(agentPage) && agentPage > 0 ? agentPage : 1,
      }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
