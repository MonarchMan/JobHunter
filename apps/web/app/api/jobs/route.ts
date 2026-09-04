import { ZodError } from 'zod';
import { badRequestResponse, dataResponse, errorResponse } from '../../../src/server/http.js';
import { parseWebJobQuery, queryRecord } from '../../../src/server/job-query.js';
import { getWebContainer } from '../../../src/server/container.js';

export const dynamic = 'force-dynamic';

/** 解析职位查询参数并返回分页职位列表。 */
export async function GET(request: Request): Promise<Response> {
  try {
    // 1、先在 HTTP 边界解析并校验查询参数，避免非法输入进入应用层。
    const query = parseWebJobQuery(queryRecord(new URL(request.url).searchParams));
    // 2、按需装配容器并调用职位查询服务。
    const container = await getWebContainer();
    return dataResponse(container.services.webJobs.list(query));
  } catch (error) {
    if (error instanceof ZodError || error instanceof TypeError) return badRequestResponse();
    return errorResponse(error);
  }
}
