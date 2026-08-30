import { ResumeMediaError } from '@jobhunter/application/web';
import {
  badRequestResponse,
  dataResponse,
  forbiddenResponse,
} from '../../../../../src/server/http.js';
import { getWebContainer } from '../../../../../src/server/container.js';
import { verifyMutationRequest } from '../../../../../src/server/csrf.js';
import { interviewErrorResponse } from '../../../../../src/server/interview-http.js';

export const dynamic = 'force-dynamic';
const maximumFileBytes = 10 * 1024 * 1024;

export async function POST(request: Request): Promise<Response> {
  if (!verifyMutationRequest(request)) return forbiddenResponse();
  try {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return badRequestResponse('请选择 Markdown、TXT、PDF 或 DOCX 文件。');
    }
    if (file.size < 1 || file.size > maximumFileBytes) {
      return badRequestResponse('面经文件必须大于 0 且不超过 10 MiB。');
    }
    const result = await (
      await getWebContainer()
    ).services.experiences.importFile({
      bytes: new Uint8Array(await file.arrayBuffer()),
      fileName: file.name,
      signal: request.signal,
    });
    return dataResponse(
      { documentId: result.detail.document.id, deduplicated: result.deduplicated },
      { status: result.deduplicated ? 200 : 201 },
    );
  } catch (error) {
    if (error instanceof ResumeMediaError || error instanceof TypeError) {
      return badRequestResponse('文件格式无效，请使用 UTF-8 Markdown/TXT、PDF 或 DOCX。');
    }
    return interviewErrorResponse(error);
  }
}
