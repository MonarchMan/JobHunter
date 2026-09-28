import { z } from 'zod';

/** 页面探针仅返回固定状态，不把正文、地址或认证字段带出浏览器。 */
export const bossPageStateSchema = z.enum([
  'loading',
  'ready',
  'login_required',
  'verification_required',
  'access_blocked',
  'rate_limited',
  'unexpected_page',
]);
export type BossPageState = z.infer<typeof bossPageStateSchema>;

/** 只读页面正常就绪与可见风险；安全检查查询参数本身不代表失败。 */
export const bossPageStateExpression = `(() => {
  // 1、禁止跨站读取，临时空白仅视为加载中。
  if (location.href === 'about:blank') return 'loading';
  if (location.origin !== 'https://www.zhipin.com') return 'unexpected_page';
  const visible = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const any = selector => [...document.querySelectorAll(selector)].some(visible);
  const text = (document.body?.innerText || '').slice(0, 10000);
  // 2、可见验证控件优先，正常职位内容避免正文关键词被误判为风险页。
  if (any('.geetest_panel, .captcha, [class*="captcha"], iframe[src*="captcha"], iframe[src*="verify"]')) return 'verification_required';
  if (location.pathname.startsWith('/web/user/')) return 'login_required';
  const jobs = any('.job-card-wrap, .job-card-box, .rec-job-list, .job-list-container');
  if (!jobs) {
    if (/验证码|安全验证|完成验证/.test(text)) return 'verification_required';
    if (/访问被拒绝|账号异常|账号受限|^403(?:\\s|$)/i.test(text.trim())) return 'access_blocked';
    if (/操作频繁|访问频繁|请求频繁|频率限制/.test(text)) return 'rate_limited';
  }
  // 3、页面正常且渲染列表才就绪；数据完整性由实际 JSON 另行验证。
  return location.pathname === '/web/geek/jobs' && document.readyState === 'complete' && jobs ? 'ready' : 'loading';
})()`;
