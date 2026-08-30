import { getWebContainer } from '../../../../../../src/server/container.js';
import { interviewErrorResponse } from '../../../../../../src/server/interview-http.js';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  try {
    const { id } = await context.params;
    const schema = await (await getWebContainer()).services.research.schema(id, request.signal);
    return new Response(JSON.stringify(schema, null, 2), {
      headers: {
        'content-type': 'application/schema+json; charset=utf-8',
        'content-disposition': `attachment; filename="community-research-${id}-schema.json"`,
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    return interviewErrorResponse(error);
  }
}
