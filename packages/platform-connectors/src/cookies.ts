/** 浏览器会话 Cookie；仅在基础设施内存中使用，不进入任务或业务模型。 */
export interface BrowserCookie {
  readonly name: string;
  readonly value: string;
  readonly domain: string;
  readonly path: string;
  readonly secure: boolean;
  readonly expires: number;
}

/** 按目标域、路径和有效期匹配 Cookie，不将整个浏览器 Cookie 集合盲目拼接。 */
export function cookieHeaderForUrl(
  cookies: readonly BrowserCookie[],
  url: URL,
  now: number,
): string {
  // 1、仅允许精确 BOSS HTTPS 主机，防止凭据转发到其他站点或子域。
  if (url.origin !== 'https://www.zhipin.com') return '';
  return (
    cookies
      .filter((cookie) => {
        // 2、拒绝头部注入、过期及不匹配路径；会话 Cookie 的 expires 通常为 -1。
        if (!/^[!#$%&'*+.^_`|~\w-]+$/.test(cookie.name) || /[\r\n;]/.test(cookie.value))
          return false;
        if (cookie.expires >= 0 && cookie.expires * 1_000 <= now) return false;
        if (cookie.secure && url.protocol !== 'https:') return false;
        const host = cookie.domain.startsWith('.') ? cookie.domain.slice(1) : cookie.domain;
        if (host !== 'zhipin.com' && host !== 'www.zhipin.com') return false;
        if (cookie.domain.startsWith('.')) {
          if (url.hostname !== host && !url.hostname.endsWith(`.${host}`)) return false;
        } else if (url.hostname !== host) return false;
        return (
          cookie.path.startsWith('/') &&
          (url.pathname === cookie.path ||
            (url.pathname.startsWith(cookie.path) &&
              (cookie.path.endsWith('/') || url.pathname[cookie.path.length] === '/')))
        );
      })
      // 3、同名 Cookie 保持更具体路径优先，不丢弃路径语义。
      .toSorted((a, b) => b.path.length - a.path.length)
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join('; ')
  );
}
