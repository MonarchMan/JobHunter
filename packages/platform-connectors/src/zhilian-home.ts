import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { PlatformError } from '@jobhunter/platform-core';
import { ZhilianSearchHttpSession } from './zhilian-search.js';

/** 首页单次请求的认证字段，禁止把不同请求的令牌拼成一个会话。 */
const authSchema = z.object({
  at: z.string().min(1).max(8192),
  rt: z.string().min(1).max(8192),
  resumeNumber: z.string().min(1).max(8192),
  platform: z.literal(13),
  version: z.literal('0.0.0'),
});

/** 已验证的普通搜索条件，不接受认证、私有游标或任意端点。 */
export const zhilianHomeSearchSchema = z
  .object({ keyword: z.string().trim().min(1).max(200), city: z.string().regex(/^\d{0,12}$/) })
  .strict();

/** 从首页固定请求构造 HTTP 会话；不匹配的普通页面请求直接忽略。 */
export function zhilianSessionFromHome(
  request: { method: string; url: string; postData?: string | undefined },
  search: z.infer<typeof zhilianHomeSearchSchema>,
  requestIntervalMs = 0,
): ZhilianSearchHttpSession | undefined {
  // 1、只读取预览请求的认证元数据，绝不请求或读取简历正文。
  const url = URL.parse(request.url);
  if (
    url?.origin !== 'https://fe-api.zhaopin.com' ||
    url.pathname !== '/c/i/resume/preview-standardnode' ||
    request.method !== 'POST'
  )
    return undefined;
  try {
    if (!request.postData || Buffer.byteLength(request.postData) > 32768) throw new Error();
    const auth = authSchema.parse(JSON.parse(request.postData));
    for (const key of ['at', 'rt', 'platform', 'version'] as const)
      if (
        url.searchParams.getAll(key).length !== 1 ||
        url.searchParams.get(key) !== String(auth[key])
      )
        throw new Error();
    const query = zhilianHomeSearchSchema.parse(search);
    // 2、只构造已验证协议，实验支持 resumeNumber 用作 cvNumber，失败不扩大上下文。
    const body = {
      ...auth,
      cvNumber: auth.resumeNumber,
      S_SOU_FULL_INDEX: query.keyword,
      S_SOU_WORK_CITY: query.city,
      order: 0,
      actionid: randomUUID().replaceAll('-', ''),
      pageSize: 20,
      pageIndex: 1,
      eventScenario: 'pcSearchedSouSearch',
      anonymous: 0,
      clickFilterBlackCompany: false,
      sortType: 'DEFAULT',
    };
    const list = new URL('https://fe-api.zhaopin.com/c/i/search/positions');
    for (const key of ['at', 'rt', 'platform', 'version'] as const)
      list.searchParams.set(key, String(auth[key]));
    const detail = new URL(list);
    detail.pathname = '/c/i/jobs/position-detailv3';
    for (const [key, value] of Object.entries({
      number: 'pending',
      cvNumber: auth.resumeNumber,
      resumeNumber: auth.resumeNumber,
      identity: '1',
    }))
      detail.searchParams.set(key, value);
    const headers = {
      accept: 'application/json, text/plain, */*',
      'x-zp-platform': '13',
      'x-zp-business-system': '1',
    };
    return new ZhilianSearchHttpSession({
      requestIntervalMs,
      templates: {
        list: { url: list.href, headers, body: JSON.stringify(body) },
        detail: { url: detail.href, headers },
      },
    });
  } catch {
    // 3、边界失败只报告固定原因，不能泄漏上游 URL、正文或认证值。
    throw new PlatformError('session_unavailable', null, 'auth_context_missing');
  }
}
