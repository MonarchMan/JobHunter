import {
  webCommunityExperienceFilterSchema,
  webCreateExperienceResearchSchema,
} from '@jobhunter/application/web';
import { getWebContainer } from '../../../../src/server/container.js';
import { verifyMutationRequest } from '../../../../src/server/csrf.js';
import { dataResponse, forbiddenResponse } from '../../../../src/server/http.js';
import { interviewErrorResponse } from '../../../../src/server/interview-http.js';

export const dynamic = 'force-dynamic';

/** 查询历史研究请求和已接收的网友面经。 */
export async function GET(request: Request): Promise<Response> {
  try {
    // 1、从 URL 参数构造并校验筛选条件。
    const service = (await getWebContainer()).services.research;
    const search = new URL(request.url).searchParams;
    const filter = webCommunityExperienceFilterSchema.parse({
      ...(search.get('company') ? { company: search.get('company') } : {}),
      ...(search.get('role') ? { role: search.get('role') } : {}),
      ...(search.get('stage') ? { stage: search.get('stage') } : {}),
    });
    // 2、读取研究请求与已接收结果，统一返回给面试准备页。
    return dataResponse({
      requests: service.listRequests(),
      accepted: service.listAccepted(filter),
    });
  } catch (error) {
    return interviewErrorResponse(error);
  }
}

/** 创建一次网友面经研究请求。 */
export async function POST(request: Request): Promise<Response> {
  // 1、写操作先进行 CSRF 校验。
  if (!verifyMutationRequest(request)) return forbiddenResponse();
  try {
    // 2、校验研究简报并登记异步研究任务。
    const brief = webCreateExperienceResearchSchema.parse(await request.json());
    const result = await (await getWebContainer()).services.research.create(brief);
    return dataResponse(result, { status: result.deduplicated ? 200 : 201 });
  } catch (error) {
    return interviewErrorResponse(error);
  }
}
