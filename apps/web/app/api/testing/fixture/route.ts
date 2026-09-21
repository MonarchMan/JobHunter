import { browserFixtureIdentity } from '../../../../src/server/browser-test-isolation.js';

export const dynamic = 'force-dynamic';

/** 仅测试夹具启用的只读身份探测；普通服务返回 404，不打开业务数据库。 */
export function GET(): Response {
  // 1、核对随机身份及临时目录，响应不包含数据路径或任何业务内容。
  const identity = browserFixtureIdentity(process.env);
  return identity
    ? new Response(null, {
        status: 204,
        headers: { 'x-jobhunter-test-run': identity, 'cache-control': 'no-store' },
      })
    : new Response(null, { status: 404 });
}
