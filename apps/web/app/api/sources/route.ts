import { webPagination } from '@jobhunter/application/web';
import { dataResponse, errorResponse } from '../../../src/server/http.js';
import { getWebContainer } from '../../../src/server/container.js';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  try {
    const container = await getWebContainer();
    const allSources = container.services.webSources.list();
    const search = new URL(request.url).searchParams;
    const requestedPage = Number(search.get('page') ?? '1');
    const pageSize = Number(search.get('limit') ?? '10');
    const pagination = webPagination(
      allSources.length,
      Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1,
      Number.isSafeInteger(pageSize) && pageSize > 0 && pageSize <= 100 ? pageSize : 10,
    );
    return dataResponse({
      sources: allSources.slice(
        (pagination.current - 1) * pagination.pageSize,
        pagination.current * pagination.pageSize,
      ),
      pagination,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
