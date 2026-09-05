import { webSettingsMutationSchema, webSettingsSchema } from '@jobhunter/application/web';
import { ZodError } from 'zod';
import { getWebContainer } from '../../../src/server/container.js';
import {
  badRequestResponse,
  dataResponse,
  errorResponse,
  forbiddenResponse,
} from '../../../src/server/http.js';
import { verifyMutationRequest } from '../../../src/server/csrf.js';

/** 处理 Web API 的 GET 请求，读取并返回对应资源。 */
export async function GET(): Promise<Response> {
  try {
    const container = await getWebContainer();
    return dataResponse(webSettingsSchema.parse(container.services.settings.get()));
  } catch (error) {
    return errorResponse(error);
  }
}

/** 处理 Web API 的 PATCH 请求，校验输入并更新资源。 */
export async function PATCH(request: Request): Promise<Response> {
  if (!verifyMutationRequest(request)) return forbiddenResponse();
  try {
    const body = (await request.json()) as unknown;
    const mutation = webSettingsMutationSchema.parse(body);
    const container = await getWebContainer();
    const settings = container.services.settings.update(mutation);
    container.services.sourceSchedules.reconcile();
    return dataResponse(webSettingsSchema.parse(settings));
  } catch (error) {
    if (error instanceof ZodError || error instanceof TypeError) {
      return badRequestResponse('系统设置无效。');
    }
    return errorResponse(error);
  }
}
