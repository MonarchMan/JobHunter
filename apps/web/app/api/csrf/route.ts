import { issueCsrfResponse } from '../../../src/server/csrf.js';

export function GET(): Response {
  return issueCsrfResponse();
}
