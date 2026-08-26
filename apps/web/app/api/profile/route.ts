import {
  CandidateProfileNotFoundError,
  ProfileVersionConflictError,
  webProfileMutationSchema,
} from '@jobhunter/application/web';
import { ZodError } from 'zod';
import {
  badRequestResponse,
  conflictResponse,
  dataResponse,
  errorResponse,
  forbiddenResponse,
  notFoundResponse,
} from '../../../src/server/http.js';
import { getWebContainer } from '../../../src/server/container.js';
import { verifyMutationRequest } from '../../../src/server/csrf.js';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  try {
    const container = await getWebContainer();
    const profiles = container.services.webProfiles.list();
    const selected = new URL(request.url).searchParams.get('profile') ?? profiles[0]?.id;
    return dataResponse({
      profiles,
      detail: selected ? container.services.webProfiles.get(selected) : null,
    });
  } catch (error) {
    if (error instanceof CandidateProfileNotFoundError) return notFoundResponse('个人资料不存在。');
    if (error instanceof ZodError || error instanceof TypeError) return badRequestResponse();
    return errorResponse(error);
  }
}

export async function PATCH(request: Request): Promise<Response> {
  if (!verifyMutationRequest(request)) return forbiddenResponse();
  try {
    const mutation = webProfileMutationSchema.parse(await request.json());
    const container = await getWebContainer();
    return dataResponse(container.services.webProfiles.mutate(mutation));
  } catch (error) {
    if (error instanceof ProfileVersionConflictError) {
      return conflictResponse('PROFILE_VERSION_CONFLICT', '画像已产生新版本，请刷新后重试。', {
        currentVersionId: error.currentVersionId,
      });
    }
    if (error instanceof CandidateProfileNotFoundError) return notFoundResponse('个人资料不存在。');
    if (error instanceof ZodError || error instanceof TypeError)
      return badRequestResponse('个人资料修改内容无效。');
    return errorResponse(error);
  }
}
