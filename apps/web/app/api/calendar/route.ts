import { webCalendarQuerySchema } from '@jobhunter/application/web';
import { ZodError } from 'zod';
import { badRequestResponse, dataResponse, errorResponse } from '../../../src/server/http.js';
import { getWebContainer } from '../../../src/server/container.js';

export const dynamic = 'force-dynamic';

/** 按用户时区和本地日期范围返回当前有效招聘日程。 */
export async function GET(request: Request): Promise<Response> {
  try {
    const search = new URL(request.url).searchParams;
    // 1、HTTP 边界校验日期和时区；2、应用服务重建改期、取消后的当前日程投影。
    const query = webCalendarQuerySchema.parse({
      dateFrom: search.get('dateFrom'),
      dateTo: search.get('dateTo'),
      ...(search.get('timezone') ? { timezone: search.get('timezone') } : {}),
    });
    const container = await getWebContainer();
    return dataResponse(container.services.calendar.list(query));
  } catch (error) {
    if (error instanceof ZodError || error instanceof TypeError) {
      return badRequestResponse('日历日期范围或时区无效。');
    }
    return errorResponse(error);
  }
}
