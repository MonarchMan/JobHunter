import { z } from 'zod';
import { getWebContainer, getWebMutationContainer } from '../../../../../src/server/container.js';
import { verifyMutationRequest } from '../../../../../src/server/csrf.js';
import { dataResponse, forbiddenResponse } from '../../../../../src/server/http.js';
import { interviewErrorResponse } from '../../../../../src/server/interview-http.js';

interface Context {
  params: Promise<{ id: string }>;
}
/** 会话读取不触发模型调用。 */
export async function GET(_request: Request, context: Context): Promise<Response> {
  try {
    return dataResponse(
      (await getWebContainer()).services.aiSessions.detail((await context.params).id),
    );
  } catch (error) {
    return interviewErrorResponse(error);
  }
}
/** 保存用户消息并原子发布独立回复任务。 */
export async function POST(request: Request, context: Context): Promise<Response> {
  if (!verifyMutationRequest(request)) return forbiddenResponse();
  try {
    const body = z
      .object({ content: z.string() })
      .strict()
      .parse(await request.json());
    return dataResponse(
      (await getWebMutationContainer()).services.aiSessions.send(
        (await context.params).id,
        body.content,
      ),
      { status: 202 },
    );
  } catch (error) {
    return interviewErrorResponse(error);
  }
}
/** 覆盖当前回答，不自动重写已经生成的后续回复。 */
export async function PATCH(request: Request, context: Context): Promise<Response> {
  if (!verifyMutationRequest(request)) return forbiddenResponse();
  try {
    const body = z
      .object({ messageId: z.string(), content: z.string(), expectedUpdatedAt: z.number().int() })
      .strict()
      .parse(await request.json());
    (await getWebMutationContainer()).services.aiSessions.edit(
      (await context.params).id,
      body.messageId,
      body.content,
      body.expectedUpdatedAt,
    );
    return dataResponse({ saved: true });
  } catch (error) {
    return interviewErrorResponse(error);
  }
}
/** 删除会话解除账本关联，不删除模型调用统计。 */
export async function DELETE(request: Request, context: Context): Promise<Response> {
  if (!verifyMutationRequest(request)) return forbiddenResponse();
  try {
    (await getWebMutationContainer()).services.aiSessions.delete((await context.params).id);
    return dataResponse({ deleted: true });
  } catch (error) {
    return interviewErrorResponse(error);
  }
}
