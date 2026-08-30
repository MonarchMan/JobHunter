import { getWebContainer } from '../../../../../../src/server/container.js';
import { verifyMutationRequest } from '../../../../../../src/server/csrf.js';
import {
  badRequestResponse,
  dataResponse,
  forbiddenResponse,
} from '../../../../../../src/server/http.js';
import { interviewErrorResponse } from '../../../../../../src/server/interview-http.js';

interface RouteContext {
  readonly params: Promise<{ readonly id: string }>;
}

export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  if (!verifyMutationRequest(request)) return forbiddenResponse();
  try {
    const { id } = await context.params;
    const form = await request.formData();
    const files = form.getAll('files').filter((value): value is File => value instanceof File);
    if (files.length !== 1) {
      return badRequestResponse('每次请求只能登记一份 Markdown 项目资料。');
    }
    const container = await getWebContainer();
    const file = files[0];
    if (!file) return badRequestResponse('请选择一份 Markdown 项目资料。');
    const result = await container.services.interview.importMaterial({
      dossierId: id,
      fileName: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
      signal: request.signal,
    });
    return dataResponse(
      [
        {
          material: result.material,
          deduplicated: result.deduplicated,
        },
      ],
      { status: result.deduplicated ? 200 : 201 },
    );
  } catch (error) {
    return interviewErrorResponse(error);
  }
}
