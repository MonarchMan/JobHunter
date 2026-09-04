import { dataResponse, errorResponse } from '../../../src/server/http.js';
import { getWebContainer } from '../../../src/server/container.js';

/** 返回任务与 Agent 运行诊断列表。 */
export async function GET(request: Request): Promise<Response> {
  try {
    // 1、解析并归一化分页、状态和任务类型筛选参数。
    const search = new URL(request.url).searchParams;
    const page = Number(search.get('taskPage') ?? '1');
    const agentPage = Number(search.get('agentPage') ?? '1');
    const status = search.get('status');
    const taskType = search.get('type');
    const validStatuses = ['pending', 'running', 'failed', 'succeeded', 'cancelled'] as const;
    // 2、通过诊断服务读取任务和 Agent 运行摘要。
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
