import { defineConfig, devices } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { browserFixtureAddress } from './src/server/browser-test-isolation.js';

const address = browserFixtureAddress(process.env);
// 1、子进程继承同一轮标识；每次独立运行使用新身份和构建目录。
const runId = process.env.JOBHUNTER_BROWSER_TEST_RUN_ID ?? randomUUID();
process.env.JOBHUNTER_BROWSER_TEST_RUN_ID = runId;

/** 浏览器端端到端测试的运行环境配置。 */
export default defineConfig({
  testDir: './test/browser',
  fullyParallel: false,
  workers: 1,
  reporter: 'line',
  globalSetup: './test/browser/global-setup.ts',
  metadata: { fixtureRunId: runId },
  use: {
    baseURL: address.baseURL,
    trace: 'retain-on-failure',
    ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH
      ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } }
      : {}),
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: `"${process.execPath}" node_modules/tsx/dist/cli.mjs test/browser/fixture-server.ts`,
    url: `${address.baseURL}/api/dashboard`,
    reuseExistingServer: false,
    env: {
      PLAYWRIGHT_FIXTURE_PORT: address.port,
      JOBHUNTER_BROWSER_TEST_RUN_ID: runId,
      NEXT_DIST_DIR: `.next-browser-fixture-${runId}`,
    },
    timeout: 60_000,
  },
});
