import { webPagination } from '@jobhunter/application/web';
import { dataResponse, errorResponse } from '../../../src/server/http.js';
import { getWebContainer } from '../../../src/server/container.js';

export const dynamic = 'force-dynamic';

/** 返回招聘来源渠道的分页列表。 */
export async function GET(request: Request): Promise<Response> {
  try {
    // 1、读取来源渠道快照和 URL 分页参数。
    const container = await getWebContainer();
    const allSources = container.services.webSources.listChannels();
    const search = new URL(request.url).searchParams;
    const requestedPage = Number(search.get('page') ?? '1');
    const pageSize = Number(search.get('limit') ?? '10');
    // 2、将不可信分页值归一化后计算稳定的分页元数据。
    const pagination = webPagination(
      allSources.length,
      Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1,
      Number.isSafeInteger(pageSize) && pageSize > 0 && pageSize <= 100 ? pageSize : 10,
    );
    // 3、按分页窗口切片，保持响应只包含当前页数据。
    return dataResponse({
      channels: allSources.slice(
        (pagination.current - 1) * pagination.pageSize,
        pagination.current * pagination.pageSize,
      ),
      pagination,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
