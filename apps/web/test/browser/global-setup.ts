import type { FullConfig } from '@playwright/test';
import { assertBrowserFixture } from '../../src/server/browser-test-isolation.js';

/** 启动门禁只发 GET；拒绝没有本轮身份的服务，不允许浏览器用例进入写阶段。 */
export default async function verifyFixture(config: FullConfig): Promise<void> {
  // 1、使用 Playwright 已解析的目标与身份，不从页面内容推断测试环境。
  const url = config.projects[0]?.use.baseURL;
  const expected: unknown = config.metadata.fixtureRunId;
  if (!url || typeof expected !== 'string') throw new Error('Missing browser fixture identity');
  const response = await fetch(`${url}/api/testing/fixture`, {
    redirect: 'manual',
    signal: AbortSignal.timeout(10000),
  });
  try {
    assertBrowserFixture(response, expected);
  } finally {
    await response.body?.cancel();
  }
}
