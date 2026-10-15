import {
  buildGmailAuthorizationUrl,
  buildMicrosoftGraphAuthorizationUrl,
} from '@jobhunter/mail-connectors';
import { getWebContainer } from '../../../../../../src/server/container.js';
import { verifyMutationRequest } from '../../../../../../src/server/csrf.js';
import {
  badRequestResponse,
  dataResponse,
  forbiddenResponse,
} from '../../../../../../src/server/http.js';
import {
  createMailOAuthAttempt,
  type MailOAuthProvider,
} from '../../../../../../src/server/mail-oauth-cookie.js';

/** 创建 Gmail 或 Microsoft 只读 OAuth 授权尝试，并返回浏览器跳转地址。 */
export async function POST(
  request: Request,
  context: { readonly params: Promise<{ readonly provider: string }> },
): Promise<Response> {
  if (!verifyMutationRequest(request)) return forbiddenResponse();
  const { provider: rawProvider } = await context.params;
  const provider = parseProvider(rawProvider);
  if (!provider) return badRequestResponse('不支持的邮箱类型。');
  const container = await getWebContainer();
  // 1、创建一次性 state 与 PKCE；2、生成最小只读权限地址；3、把 verifier 放入 HttpOnly Cookie。
  const attempt = createMailOAuthAttempt(provider, new URL(request.url).protocol === 'https:');
  let authorizationUrl: string;
  if (provider === 'gmail') {
    const config = container.mailOAuth.gmail;
    if (!config) {
      return badRequestResponse(
        '尚未配置 Gmail OAuth 客户端，请先设置 JOBHUNTER_GMAIL_CLIENT_ID。',
      );
    }
    authorizationUrl = buildGmailAuthorizationUrl(config, attempt.state, {
      codeChallenge: attempt.codeChallenge,
    });
  } else {
    const config = container.mailOAuth.microsoftGraph;
    if (!config) {
      return badRequestResponse(
        '尚未配置 Microsoft OAuth 客户端，请先设置 JOBHUNTER_MICROSOFT_CLIENT_ID。',
      );
    }
    authorizationUrl = buildMicrosoftGraphAuthorizationUrl(config, attempt.state, config.tenant, {
      codeChallenge: attempt.codeChallenge,
    });
  }
  const response = dataResponse({ authorizationUrl });
  response.headers.append('Set-Cookie', attempt.cookie);
  return response;
}

/** 将路由片段限制为两种 OAuth provider。 */
function parseProvider(value: string): MailOAuthProvider | null {
  return value === 'gmail' || value === 'microsoft-graph' ? value : null;
}
