import path from 'node:path';
import { tmpdir } from 'node:os';

/** 夹具身份只在独立临时数据目录的开发服务中启用，普通应用绝不伪装测试服务。 */
export function browserFixtureIdentity(environment: NodeJS.ProcessEnv): string | null {
  // 1、随机身份、运行模式和临时目录三者同时满足才返回非敏感标识。
  const id = environment.JOBHUNTER_BROWSER_TEST_RUN_ID;
  const root = environment.JOBHUNTER_DATA_ROOT;
  if (
    !id ||
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id) ||
    !root ||
    environment.NODE_ENV === 'production'
  )
    return null;
  if (
    path.dirname(path.resolve(root)) !== path.resolve(tmpdir()) ||
    !path.basename(root).startsWith('jobhunter-web-browser-')
  )
    return null;
  return id;
}

/** 测试只能连接专属 loopback 端口，禁止配置覆盖后误向其他服务提交任务。 */
export function browserFixtureAddress(environment: NodeJS.ProcessEnv): {
  port: string;
  baseURL: string;
} {
  // 1、端口有界，URL 必须精确匹配本轮夹具；不接受远程地址、路径或凭据。
  const port = environment.PLAYWRIGHT_FIXTURE_PORT ?? '3217';
  if (!/^\d{1,5}$/.test(port) || Number(port) < 1024 || Number(port) > 65535)
    throw new Error('Invalid browser fixture port');
  const baseURL = `http://127.0.0.1:${port}`;
  if (environment.PLAYWRIGHT_BASE_URL && environment.PLAYWRIGHT_BASE_URL !== baseURL)
    throw new Error('Browser tests require the dedicated fixture URL');
  return { port, baseURL };
}

/** 只读探测完成身份核验前，不允许测试发布任何变更请求。 */
export function assertBrowserFixture(response: Response, expected: string): void {
  // 1、拒绝错误服务、重定向或旧夹具；错误信息不输出响应正文。
  if (
    !response.ok ||
    response.redirected ||
    response.headers.get('x-jobhunter-test-run') !== expected
  )
    throw new Error('Browser fixture identity mismatch; tests stopped before mutations');
}
