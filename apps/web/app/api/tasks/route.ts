import { dataResponse, errorResponse } from '../../../src/server/http.js';
import { getWebContainer } from '../../../src/server/container.js';

export async function GET(): Promise<Response> {
  try {
    const container = await getWebContainer();
    return dataResponse(container.services.diagnostics.list());
  } catch (error) {
    return errorResponse(error);
  }
}
