import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export type MailOAuthProvider = 'gmail' | 'microsoft-graph';

const cookieName = 'jobhunter_mail_oauth';

/** 创建一次性 OAuth state、PKCE verifier 和对应的 HttpOnly Cookie。 */
export function createMailOAuthAttempt(
  provider: MailOAuthProvider,
  secure: boolean,
): {
  readonly state: string;
  readonly codeVerifier: string;
  readonly codeChallenge: string;
  readonly cookie: string;
} {
  const state = randomBytes(32).toString('base64url');
  const codeVerifier = randomBytes(48).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  const value = `${provider}.${state}.${codeVerifier}`;
  return {
    state,
    codeVerifier,
    codeChallenge,
    cookie: `${cookieName}=${value}; Path=/api/mailboxes/oauth; HttpOnly; SameSite=Lax; Max-Age=600${secure ? '; Secure' : ''}`,
  };
}

/** 校验回调 state 并取回 PKCE verifier；失败时不暴露 Cookie 内容。 */
export function verifyMailOAuthAttempt(
  request: Request,
  provider: MailOAuthProvider,
  state: string,
): string | null {
  const raw = readCookie(request.headers.get('cookie'), cookieName);
  if (!raw) return null;
  const [storedProvider, storedState, codeVerifier] = raw.split('.');
  if (storedProvider !== provider || !storedState || !codeVerifier) return null;
  const actual = Buffer.from(state);
  const expected = Buffer.from(storedState);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  return codeVerifier;
}

/** 清除 OAuth 尝试 Cookie，避免授权码回调被重复消费。 */
export function clearMailOAuthCookie(secure: boolean): string {
  return `${cookieName}=; Path=/api/mailboxes/oauth; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}

/** 从 Cookie 请求头读取单个值，不接受重复键的后续覆盖。 */
function readCookie(header: string | null, name: string): string | null {
  for (const item of header?.split(';') ?? []) {
    const separator = item.indexOf('=');
    if (separator < 0) continue;
    if (item.slice(0, separator).trim() === name) return item.slice(separator + 1).trim();
  }
  return null;
}
