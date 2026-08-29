import { getWebContainer } from '../../../../../../src/server/container.js';
import { interviewErrorResponse } from '../../../../../../src/server/interview-http.js';

interface RouteContext {
  readonly params: Promise<{ readonly id: string }>;
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { id } = await context.params;
    const container = await getWebContainer();
    const notebook = await container.services.interview.readNotebook(id, request.signal);
    return new Response(Uint8Array.from(notebook.content).buffer, {
      headers: {
        'cache-control': 'no-store',
        'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(notebook.filename)}`,
        'content-type': notebook.mediaType,
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    return interviewErrorResponse(error);
  }
}
