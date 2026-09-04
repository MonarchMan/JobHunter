import { issueCsrfResponse } from '../../../src/server/csrf.js';

/** 返回当前会话可用的 CSRF 令牌。 */
export function GET(): Response {
  return issueCsrfResponse();
}
