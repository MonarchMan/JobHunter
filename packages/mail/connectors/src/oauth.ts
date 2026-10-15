import { MailConnectorError } from '@jobhunter/mail-core';

/** OAuth 授权配置；clientSecret 只在本机 code exchange 短生命周期内使用。 */
export interface OAuthClientConfig {
  readonly clientId: string;
  readonly clientSecret?: string;
  readonly redirectUri: string;
}

/** 已交换的 OAuth 凭据；调用方应立即写入 CredentialVault。 */
export interface OAuthTokenSet {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly expiresAt: number | null;
  readonly scope: string;
  readonly tokenType: string;
}

/** OAuth 授权地址的 PKCE 参数，避免回调授权码被其他本机进程重放。 */
export interface OAuthAuthorizationSecurity {
  readonly codeChallenge: string;
}

/** 生成 Gmail 只读授权地址，state 必须由调用方随机生成并绑定本机会话。 */
export function buildGmailAuthorizationUrl(
  config: OAuthClientConfig,
  state: string,
  security?: OAuthAuthorizationSecurity,
): string {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('scope', 'https://www.googleapis.com/auth/gmail.readonly');
  url.searchParams.set('state', state);
  if (security) {
    url.searchParams.set('code_challenge', security.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
  }
  return url.toString();
}

/** 生成 Microsoft Graph delegated Mail.Read 授权地址。 */
export function buildMicrosoftGraphAuthorizationUrl(
  config: OAuthClientConfig,
  state: string,
  tenant = 'common',
  security?: OAuthAuthorizationSecurity,
): string {
  const url = new URL(
    `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/authorize`,
  );
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('response_mode', 'query');
  url.searchParams.set('scope', 'openid offline_access Mail.Read');
  url.searchParams.set('state', state);
  if (security) {
    url.searchParams.set('code_challenge', security.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
  }
  return url.toString();
}

/** 使用授权码交换 token；不记录响应正文，也不把 token 写入普通日志。 */
export async function exchangeOAuthCode(
  provider: 'gmail' | 'microsoft-graph',
  config: OAuthClientConfig,
  code: string,
  tenant = 'common',
  codeVerifier?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<OAuthTokenSet> {
  const endpoint =
    provider === 'gmail'
      ? 'https://oauth2.googleapis.com/token'
      : `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: config.clientId,
    code,
    redirect_uri: config.redirectUri,
    grant_type: 'authorization_code',
  });
  if (config.clientSecret) body.set('client_secret', config.clientSecret);
  if (codeVerifier) body.set('code_verifier', codeVerifier);
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  if (!response.ok)
    throw new MailConnectorError(
      response.status === 401
        ? 'authentication_required'
        : response.status >= 500
          ? 'upstream_5xx'
          : 'permission_denied',
      'OAuth code exchange failed.',
    );
  const payload = (await response.json()) as Record<string, unknown>;
  if (typeof payload.access_token !== 'string')
    throw new MailConnectorError('parse_changed', 'OAuth provider returned no access token.');
  const expiresIn = typeof payload.expires_in === 'number' ? payload.expires_in : null;
  return {
    accessToken: payload.access_token,
    refreshToken: typeof payload.refresh_token === 'string' ? payload.refresh_token : null,
    expiresAt: expiresIn === null ? null : Date.now() + expiresIn * 1000,
    scope: typeof payload.scope === 'string' ? payload.scope : '',
    tokenType: typeof payload.token_type === 'string' ? payload.token_type : 'Bearer',
  };
}

/** 使用刚取得的访问令牌读取邮箱身份；响应只用于生成脱敏配置，不持久化原始资料。 */
export async function fetchOAuthMailboxAddress(
  provider: 'gmail' | 'microsoft-graph',
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const endpoint =
    provider === 'gmail'
      ? 'https://gmail.googleapis.com/gmail/v1/users/me/profile'
      : 'https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName';
  const response = await fetchImpl(endpoint, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new MailConnectorError(
      response.status === 401
        ? 'authentication_required'
        : response.status === 403
          ? 'permission_denied'
          : response.status >= 500
            ? 'upstream_5xx'
            : 'parse_changed',
      'OAuth mailbox identity request failed.',
    );
  }
  const payload = (await response.json()) as Record<string, unknown>;
  const address =
    provider === 'gmail'
      ? payload.emailAddress
      : typeof payload.mail === 'string' && payload.mail.length > 0
        ? payload.mail
        : payload.userPrincipalName;
  if (typeof address !== 'string' || !/^.+@.+\..+$/.test(address)) {
    throw new MailConnectorError('parse_changed', 'OAuth provider returned no mailbox address.');
  }
  return address;
}
