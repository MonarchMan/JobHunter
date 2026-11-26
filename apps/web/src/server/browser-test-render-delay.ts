import { setTimeout } from 'node:timers/promises';
import { headers } from 'next/headers.js';
import { browserFixtureIdentity } from './browser-test-isolation.js';

/** 隔离夹具可延迟一个数据区，用于验证流式显示顺序；正常服务忽略测试请求头。 */
export function browserTestRenderDelay(section: string): Promise<void> | undefined {
  if (!browserFixtureIdentity(process.env)) return undefined;
  return headers().then(async (requestHeaders) => {
    if (requestHeaders.get('x-jobhunter-test-delay-section') === section) {
      await setTimeout(2_000);
    }
  });
}
