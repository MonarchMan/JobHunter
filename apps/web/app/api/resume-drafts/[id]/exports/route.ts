import { z } from 'zod';
import { getWebContainer } from '../../../../../src/server/container.js';
import { verifyMutationRequest } from '../../../../../src/server/csrf.js';
import { dataResponse, forbiddenResponse } from '../../../../../src/server/http.js';
import { resumeErrorResponse } from '../../../../../src/server/resume-http.js';

/** 模块数据结构或契约。 */
interface RouteContext {
  readonly params: Promise<{ readonly id: string }>;
}

const exportSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    format: z.enum(['html', 'pdf']),
    idempotencyToken: z.string().max(200),
  })
  .strict();

/** 处理 Web API 的 POST 请求，校验输入并提交业务操作。 */
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  if (!verifyMutationRequest(request)) return forbiddenResponse();
  try {
    const { id } = await context.params;
    const input = exportSchema.parse(await request.json());
    const container = await getWebContainer();
    const exported = await container.services.resumeTemplates.export({ id, ...input });
    return dataResponse(exported, { status: input.format === 'pdf' ? 202 : 201 });
  } catch (error) {
    return resumeErrorResponse(error);
  }
}
