import { dataResponse } from '../../../src/server/http.js';
import { getWebContainer } from '../../../src/server/container.js';
import { resumeErrorResponse } from '../../../src/server/resume-http.js';

/** 返回可用的简历模板目录。 */
export async function GET(): Promise<Response> {
  try {
    // 1、从 Web 容器取得模板服务。
    const container = await getWebContainer();
    // 2、返回模板目录并统一处理异常。
    return dataResponse(container.services.resumeTemplates.listTemplates());
  } catch (error) {
    return resumeErrorResponse(error);
  }
}
