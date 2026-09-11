/** 等待官网 webpack5 固定模块就绪，桥接只运行在隔离匿名页面。 */
export function didiMokaRuntimeReady(): boolean {
  interface Require {
    m: Record<string, unknown>;
  }
  const root = globalThis as unknown as {
    webpackChunkmage_cli_jsonp?: { push: (v: unknown) => unknown };
    __jobhunterDidiRequire?: Require;
  };
  if (
    !root.webpackChunkmage_cli_jsonp ||
    root.webpackChunkmage_cli_jsonp.push === Array.prototype.push
  )
    return false;
  if (!root.__jobhunterDidiRequire)
    root.webpackChunkmage_cli_jsonp.push([
      ['jobhunter_didi_bridge'],
      {},
      (require: Require) => {
        root.__jobhunterDidiRequire = require;
      },
    ]);
  return typeof root.__jobhunterDidiRequire?.m['0wyxq0'] === 'function';
}
/** 调用官网自身客户端处理公开响应，固定公司/站点/路径，不抽取解密实现。 */
export async function invokeDidiMoka(input: {
  key: 'didi.intern' | 'didi.campus' | 'didi.campus.elite';
  operation: 'list' | 'detail';
  page?: number;
  id?: string;
}): Promise<unknown> {
  // 1、仅接受当前已验证的 Moka HTTP 模块，不扫描其他导出。
  const root = globalThis as unknown as {
    __jobhunterDidiRequire?: (key: string) => {
      default?: (path: string) => { post: (body: unknown) => Promise<unknown> };
    };
  };
  const factory = root.__jobhunterDidiRequire?.('0wyxq0').default;
  if (typeof factory !== 'function') throw new Error('Official Moka client changed.');
  if (!['didi.intern', 'didi.campus', 'didi.campus.elite'].includes(input.key))
    throw new Error('Unsupported Moka site.');
  const campus = input.key !== 'didi.intern';
  const siteId = input.key === 'didi.campus.elite' ? '116021' : campus ? '96064' : '6222';
  // 2、固定公开列表与岗位详情操作，无登录、候选人或任意 API 能力。
  if (input.operation === 'list' && Number.isSafeInteger(input.page) && (input.page ?? 0) > 0)
    return factory('/api/outer/ats-apply/website/jobs/v2').post({
      orgId: 'didiglobal',
      siteId,
      limit: 30,
      offset: ((input.page ?? 1) - 1) * 30,
      needStat: true,
      jobIdTopList: [],
      customFields: {},
      site: campus ? 'campus' : 'social',
      locale: 'zh-CN',
    });
  if (
    input.operation === 'detail' &&
    input.id &&
    /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(input.id)
  )
    return factory('/api/outer/ats-apply/website/job').post({
      orgId: 'didiglobal',
      siteId: Number(siteId),
      jobId: input.id,
      locale: 'zh-CN',
    });
  throw new Error('Unsupported Moka operation.');
}
