import { CandidateProfileNotFoundError } from '@jobhunter/application/web';
import { ZodError } from 'zod';
import {
  badRequestResponse,
  dataResponse,
  errorResponse,
  notFoundResponse,
} from '../../../../src/server/http.js';
import { getWebContainer } from '../../../../src/server/container.js';

export const dynamic = 'force-dynamic';

/** 处理 Web API 的 GET 请求，读取并返回对应资源。 */
export async function GET(request: Request): Promise<Response> {
  try {
    const profileId = new URL(request.url).searchParams.get('profile');
    if (!profileId) return badRequestResponse('缺少 profile 参数。');
    const container = await getWebContainer();
    return dataResponse({ versions: container.services.webProfiles.get(profileId).versions });
  } catch (error) {
    if (error instanceof CandidateProfileNotFoundError) return notFoundResponse('个人资料不存在。');
    if (error instanceof ZodError || error instanceof TypeError) return badRequestResponse();
    return errorResponse(error);
  }
}
