import { ResumeMediaError, webResumeImportResultSchema } from '@jobhunter/application/web';
import { ZodError, z } from 'zod';
import {
  badRequestResponse,
  dataResponse,
  errorResponse,
  forbiddenResponse,
} from '../../../../src/server/http.js';
import { getWebContainer } from '../../../../src/server/container.js';
import { verifyMutationRequest } from '../../../../src/server/csrf.js';

export const dynamic = 'force-dynamic';

const profileIdSchema = z.uuid().optional();
const maximumFileBytes = 10 * 1024 * 1024;

/** 处理 Web API 的 POST 请求，校验输入并提交业务操作。 */
export async function POST(request: Request): Promise<Response> {
  if (!verifyMutationRequest(request)) return forbiddenResponse();
  try {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return badRequestResponse('请选择 PDF、DOCX、JPEG 或 PNG 简历文件。');
    }
    if (file.size < 1 || file.size > maximumFileBytes) {
      return badRequestResponse('简历文件必须大于 0 且不超过 10 MiB。');
    }
    const profileId = profileIdSchema.parse(form.get('profileId') ?? undefined);
    const container = await getWebContainer();
    const result = await container.services.resumes.importBytes({
      bytes: new Uint8Array(await file.arrayBuffer()),
      ...(profileId ? { profileId } : {}),
      signal: request.signal,
    });
    const data = webResumeImportResultSchema.parse({
      document: result.document,
      deduplicated: result.deduplicated,
      profileId: result.profileId,
      task: result.task
        ? {
            taskId: result.task.id,
            status: result.task.status,
            deduplicated: result.taskDeduplicated,
            statusUrl: `/api/tasks/${result.task.id}`,
          }
        : null,
    });
    return dataResponse(data, { status: result.task ? 202 : 200 });
  } catch (error) {
    if (
      error instanceof ResumeMediaError ||
      error instanceof ZodError ||
      error instanceof TypeError
    ) {
      return badRequestResponse('简历文件或画像标识无效。');
    }
    return errorResponse(error);
  }
}
