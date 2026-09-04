import { z } from 'zod';
import { resumeTemplateKeySchema } from '@jobhunter/resume-template';
import { getWebContainer } from '../../../src/server/container.js';
import { verifyMutationRequest } from '../../../src/server/csrf.js';
import { dataResponse, forbiddenResponse } from '../../../src/server/http.js';
import { resumeErrorResponse } from '../../../src/server/resume-http.js';

const createSchema = z
  .object({ profileId: z.string().min(1), templateKey: resumeTemplateKeySchema })
  .strict();

/** 创建或恢复一个简历草稿。 */
export async function POST(request: Request): Promise<Response> {
  // 1、变更请求必须通过 CSRF 校验。
  if (!verifyMutationRequest(request)) return forbiddenResponse();
  try {
    // 2、解析画像与模板参数，再委托应用服务持久化草稿。
    const input = createSchema.parse(await request.json());
    const container = await getWebContainer();
    return dataResponse(
      await container.services.resumeTemplates.createOrResume(input.profileId, input.templateKey),
      { status: 201 },
    );
  } catch (error) {
    return resumeErrorResponse(error);
  }
}
