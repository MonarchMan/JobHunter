import { getWebContainer } from '../../../../../../../src/server/container.js';
import { resumeErrorResponse } from '../../../../../../../src/server/resume-http.js';

interface RouteContext {
  readonly params: Promise<{ readonly id: string; readonly requestId: string }>;
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  try {
    const { id, requestId } = await context.params;
    const container = await getWebContainer();
    const exported = await container.services.resumeTemplates.deliver(id, requestId);
    return new Response(Uint8Array.from(exported.bytes).buffer, {
      headers: {
        'cache-control': 'no-store',
        'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(exported.fileName)}`,
        'content-type': exported.mediaType,
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    return resumeErrorResponse(error);
  }
}
