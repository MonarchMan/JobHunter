import { z } from 'zod';
import { getWebMutationContainer } from '../../../../../../src/server/container.js';
import { verifyMutationRequest } from '../../../../../../src/server/csrf.js';
import { dataResponse, forbiddenResponse } from '../../../../../../src/server/http.js';
import { interviewErrorResponse } from '../../../../../../src/server/interview-http.js';

/** 只检查系统指定的本地结果，不接收上传文件或客户端指定路径。 */
export async function POST(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  if (!verifyMutationRequest(request)) return forbiddenResponse();
  try {
    const input = z
      .object({ expectedRevision: z.number().int().nonnegative() })
      .strict()
      .parse(await request.json());
    const detail = await (
      await getWebMutationContainer()
    ).services.research.checkResult({
      requestId: (await context.params).id,
      expectedRevision: input.expectedRevision,
    });
    return dataResponse(detail);
  } catch (error) {
    return interviewErrorResponse(error);
  }
}
