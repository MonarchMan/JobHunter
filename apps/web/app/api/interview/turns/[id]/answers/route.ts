import { webSubmitDrillAnswerSchema } from '@jobhunter/application/web';
import { getWebContainer } from '../../../../../../src/server/container.js';
import { verifyMutationRequest } from '../../../../../../src/server/csrf.js';
import { dataResponse, forbiddenResponse } from '../../../../../../src/server/http.js';
import {
  interviewErrorResponse,
  presentInterviewTask,
} from '../../../../../../src/server/interview-http.js';

/** 模块数据结构或契约。 */
interface RouteContext {
  readonly params: Promise<{ readonly id: string }>;
}

/** 提交项目拷打回答并返回后续任务状态。 */
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  // 1、回答提交属于写操作，先验证 CSRF。
  if (!verifyMutationRequest(request)) return forbiddenResponse();
  try {
    // 2、解析路径参数和回答内容，再交给面试应用服务。
    const { id } = await context.params;
    const body = webSubmitDrillAnswerSchema.parse(await request.json());
    const container = await getWebContainer();
    return dataResponse(
      presentInterviewTask(container.services.interview.submitAnswer({ turnId: id, ...body })),
      { status: 202 },
    );
  } catch (error) {
    return interviewErrorResponse(error);
  }
}
