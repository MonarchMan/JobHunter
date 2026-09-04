import { dataResponse, errorResponse } from '../../../src/server/http.js';
import { getWebContainer } from '../../../src/server/container.js';

export const dynamic = 'force-dynamic';

/** 返回首页仪表盘聚合数据。 */
export async function GET(): Promise<Response> {
  try {
    // 1、取得共享 Web 容器，确保路由不直接操作数据库。
    const container = await getWebContainer();
    // 2、由应用服务生成只读快照并统一包装响应。
    return dataResponse(container.services.dashboard.get());
  } catch (error) {
    return errorResponse(error);
  }
}
