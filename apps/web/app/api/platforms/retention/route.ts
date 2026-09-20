import { getWebContainer } from '../../../../src/server/container.js';
import { dataResponse, errorResponse } from '../../../../src/server/http.js';

/** 仅读取清理配置的安全投影，不执行预览或删除。 */
export async function GET(): Promise<Response> {
  try {
    return dataResponse((await getWebContainer()).services.platformActivity.retentionSummary(), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
