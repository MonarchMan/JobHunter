import { z } from 'zod';
import { getWebContainer } from '../../../../../src/server/container.js';
import { verifyMutationRequest } from '../../../../../src/server/csrf.js';
import { dataResponse, forbiddenResponse } from '../../../../../src/server/http.js';
import { resumeErrorResponse } from '../../../../../src/server/resume-http.js';

/** 模块数据结构或契约。 */
interface RouteContext {
  readonly params: Promise<{ readonly id: string }>;
}

/** 处理 Web API 的 POST 请求，校验输入并提交业务操作。 */
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  if (!verifyMutationRequest(request)) return forbiddenResponse();
  try {
    const { id } = await context.params;
    const form = await request.formData();
    const file = form.get('avatar');
    if (!(file instanceof File)) throw new TypeError('请选择头像文件。');
    const expectedRevision = z.coerce
      .number()
      .int()
      .nonnegative()
      .parse(form.get('expectedRevision'));
    const container = await getWebContainer();
    return dataResponse(
      await container.services.resumeTemplates.setAvatar({
        id,
        expectedRevision,
        bytes: new Uint8Array(await file.arrayBuffer()),
        mediaType: file.type,
      }),
    );
  } catch (error) {
    return resumeErrorResponse(error);
  }
}
