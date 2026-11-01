import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

it('executes tsx-loaded Kuaishou runtime functions in Chromium without Node helpers', async () => {
  // 1、独立进程沿用开发入口的 tsx 转译，真实执行浏览器传参而不是直接调用函数。
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      '--conditions=development',
      '--import',
      'tsx',
      'apps/web/test/fixtures/kuaishou-runtime-harness.ts',
    ],
    { timeout: 20_000 },
  );
  expect(stdout).toContain('kuaishou-runtime-ok');
}, 25_000);
