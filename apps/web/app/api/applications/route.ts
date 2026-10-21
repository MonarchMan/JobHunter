import { dataResponse, errorResponse } from '../../../src/server/http.js';
import { getWebContainer } from '../../../src/server/container.js';

export const dynamic = 'force-dynamic';

/** 返回公司分组、岗位流程条和多轮面试时间线。 */
export async function GET(): Promise<Response> {
  try {
    const container = await getWebContainer();
    return dataResponse(container.services.applications.list());
  } catch (error) {
    return errorResponse(error);
  }
}
