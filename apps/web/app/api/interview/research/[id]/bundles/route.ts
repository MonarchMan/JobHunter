import { webImportExperienceResearchBundleSchema } from '@jobhunter/application/web';
import { getWebContainer } from '../../../../../../src/server/container.js';
import { verifyMutationRequest } from '../../../../../../src/server/csrf.js';
import {
  badRequestResponse,
  dataResponse,
  forbiddenResponse,
} from '../../../../../../src/server/http.js';
import { interviewErrorResponse } from '../../../../../../src/server/interview-http.js';

const maximumBundleBytes = 2 * 1024 * 1024;

/** 处理 Web API 的 POST 请求，校验输入并提交业务操作。 */
export async function POST(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  if (!verifyMutationRequest(request)) return forbiddenResponse();
  try {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return badRequestResponse('请选择 JSON 研究结果文件。');
    if (!file.name.toLowerCase().endsWith('.json')) {
      return badRequestResponse('研究结果必须是 JSON 文件。');
    }
    if (file.size < 1 || file.size > maximumBundleBytes) {
      return badRequestResponse('研究结果必须大于 0 且不超过 2 MiB。');
    }
    const revision = webImportExperienceResearchBundleSchema.parse({
      expectedRevision: form.get('expectedRevision'),
    });
    const detail = await (
      await getWebContainer()
    ).services.research.importBundle({
      requestId: (await context.params).id,
      expectedRevision: revision.expectedRevision,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    return dataResponse(detail);
  } catch (error) {
    return interviewErrorResponse(error);
  }
}
