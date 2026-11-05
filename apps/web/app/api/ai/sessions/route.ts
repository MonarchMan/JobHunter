import { createAiSessionSchema } from '@jobhunter/user/ai/service';
import { getWebContainer, getWebMutationContainer } from '../../../../src/server/container.js';
import { verifyMutationRequest } from '../../../../src/server/csrf.js';
import { dataResponse, forbiddenResponse } from '../../../../src/server/http.js';
import { interviewErrorResponse } from '../../../../src/server/interview-http.js';

/** 列出持续可用的 AI 会话。 */
export async function GET(): Promise<Response> {
  try {
    return dataResponse((await getWebContainer()).services.aiSessions.list());
  } catch (error) {
    return interviewErrorResponse(error);
  }
}
/** 创建会话，仅保存用户明确指定的可选关联。 */
export async function POST(request: Request): Promise<Response> {
  if (!verifyMutationRequest(request)) return forbiddenResponse();
  try {
    const input = createAiSessionSchema.parse(await request.json());
    return dataResponse((await getWebMutationContainer()).services.aiSessions.create(input), {
      status: 201,
    });
  } catch (error) {
    return interviewErrorResponse(error);
  }
}
