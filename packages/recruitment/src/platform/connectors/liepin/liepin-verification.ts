/** 只识别猎聘官方安全中心拦截路径，返回可公开的固定原因码。 */
export function liepinVerificationReason(
  url: URL,
): 'verification_required' | 'redirect_challenge' | undefined {
  if (url.origin !== 'https://safe.liepin.com') return undefined;
  const path = url.pathname.toLowerCase().replace(/\/$/, '');
  if (path === '/v/intercept/verifysms') return 'verification_required';
  if (path.startsWith('/v/intercept/')) return 'redirect_challenge';
  return undefined;
}
