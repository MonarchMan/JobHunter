import { webCreateProjectDossierSchema } from '@jobhunter/application/web';
import { getWebContainer } from '../../../../src/server/container.js';
import { verifyMutationRequest } from '../../../../src/server/csrf.js';
import { dataResponse, forbiddenResponse } from '../../../../src/server/http.js';
import { interviewErrorResponse } from '../../../../src/server/interview-http.js';

export const dynamic = 'force-dynamic';

/** 处理 Web API 的 GET 请求，读取并返回对应资源。 */
export async function GET(): Promise<Response> {
  try {
    const container = await getWebContainer();
    return dataResponse({
      availableProjects: container.services.interview.listAvailableProjects(),
      dossiers: container.services.interview.listDossiers(),
    });
  } catch (error) {
    return interviewErrorResponse(error);
  }
}

/** 处理 Web API 的 POST 请求，校验输入并提交业务操作。 */
export async function POST(request: Request): Promise<Response> {
  if (!verifyMutationRequest(request)) return forbiddenResponse();
  try {
    const input = webCreateProjectDossierSchema.parse(await request.json());
    const container = await getWebContainer();
    return dataResponse(container.services.interview.createDossier(input), { status: 201 });
  } catch (error) {
    return interviewErrorResponse(error);
  }
}
