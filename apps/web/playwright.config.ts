import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './test/browser',
  fullyParallel: false,
  workers: 1,
  reporter: 'line',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3210',
    trace: 'retain-on-failure',
    ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH
      ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } }
      : {}),
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: `"${process.execPath}" node_modules/tsx/dist/cli.mjs test/browser/fixture-server.ts`,
    url: `${process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3210'}/api/dashboard`,
    reuseExistingServer: true,
    env: {
      PLAYWRIGHT_FIXTURE_PORT: process.env.PLAYWRIGHT_FIXTURE_PORT ?? '3210',
    },
    timeout: 60_000,
  },
});
