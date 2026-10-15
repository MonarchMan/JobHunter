import { exchangeOAuthCode, fetchOAuthMailboxAddress } from '@jobhunter/mail-connectors';
import { getWebContainer } from '../../../../../../src/server/container.js';
import {
  clearMailOAuthCookie,
  verifyMailOAuthAttempt,
  type MailOAuthProvider,
} from '../../../../../../src/server/mail-oauth-cookie.js';

/** 完成 OAuth code exchange，把令牌写入加密凭据文件并创建脱敏邮箱配置。 */
export async function GET(
  request: Request,
  context: { readonly params: Promise<{ readonly provider: string }> },
): Promise<Response> {
  const requestUrl = new URL(request.url);
  const secure = requestUrl.protocol === 'https:';
  const { provider: rawProvider } = await context.params;
  const provider = parseProvider(rawProvider);
  if (!provider)
    return redirectToSettings(requestUrl, secure, 'mailboxError', 'unsupported_provider');
  const state = requestUrl.searchParams.get('state');
  const code = requestUrl.searchParams.get('code');
  if (requestUrl.searchParams.has('error')) {
    return redirectToSettings(requestUrl, secure, 'mailboxError', 'authorization_cancelled');
  }
  if (!state || !code)
    return redirectToSettings(requestUrl, secure, 'mailboxError', 'invalid_callback');
  const codeVerifier = verifyMailOAuthAttempt(request, provider, state);
  if (!codeVerifier) return redirectToSettings(requestUrl, secure, 'mailboxError', 'invalid_state');

  try {
    const container = await getWebContainer();
    // 1、在事务外交换令牌并读取邮箱身份；2、令牌立即进入凭据库；3、只保存脱敏地址和凭据引用。
    const tokens =
      provider === 'gmail'
        ? await exchangeGmailCode(container, code, codeVerifier)
        : await exchangeMicrosoftCode(container, code, codeVerifier);
    const address = await fetchOAuthMailboxAddress(provider, tokens.accessToken);
    await container.services.mailboxes.createOAuth({
      providerKey: provider,
      address,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      scope: tokens.scope,
      tokenType: tokens.tokenType,
      folders: [provider === 'gmail' ? 'INBOX' : 'inbox'],
      initialLookbackDays: 90,
    });
    return redirectToSettings(requestUrl, secure, 'mailboxConnected', provider);
  } catch (error) {
    process.stderr.write(
      `Mail OAuth callback failed: ${error instanceof Error ? error.name : 'UnknownError'}\n`,
    );
    return redirectToSettings(requestUrl, secure, 'mailboxError', 'oauth_failed');
  }
}

/** 交换 Gmail 授权码，并保持 provider 配置的联合类型收窄。 */
async function exchangeGmailCode(
  container: Awaited<ReturnType<typeof getWebContainer>>,
  code: string,
  codeVerifier: string,
): ReturnType<typeof exchangeOAuthCode> {
  const config = container.mailOAuth.gmail;
  if (!config) throw new Error('Gmail OAuth is not configured.');
  return exchangeOAuthCode('gmail', config, code, 'common', codeVerifier);
}

/** 交换 Microsoft 授权码，并使用配置的租户范围。 */
async function exchangeMicrosoftCode(
  container: Awaited<ReturnType<typeof getWebContainer>>,
  code: string,
  codeVerifier: string,
): ReturnType<typeof exchangeOAuthCode> {
  const config = container.mailOAuth.microsoftGraph;
  if (!config) throw new Error('Microsoft OAuth is not configured.');
  return exchangeOAuthCode('microsoft-graph', config, code, config.tenant, codeVerifier);
}

/** 返回设置页并清除一次性 OAuth Cookie，查询参数只使用固定内部状态码。 */
function redirectToSettings(
  requestUrl: URL,
  secure: boolean,
  key: 'mailboxConnected' | 'mailboxError',
  value: string,
): Response {
  const target = new URL('/settings', requestUrl);
  target.searchParams.set(key, value);
  return new Response(null, {
    status: 303,
    headers: {
      Location: target.toString(),
      'Set-Cookie': clearMailOAuthCookie(secure),
    },
  });
}

/** 将回调路由限制为两种 OAuth provider。 */
function parseProvider(value: string): MailOAuthProvider | null {
  return value === 'gmail' || value === 'microsoft-graph' ? value : null;
}
