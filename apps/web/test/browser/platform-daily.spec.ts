import { expect, test } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import type { WebBossSnapshot } from '@jobhunter/application/web';

/** 日常入口使用本地状态替身；不连接用户浏览器，也不访问招聘网站。 */
for (const provider of ['boss', 'zhilian', '51job', 'liepin']) {
  test(`${provider} 在职位页自动连接获取，复用会话并保留筛选`, async ({ page }) => {
    let state: WebBossSnapshot = { connection: null, batch: null, saved: {}, task: null };
    const commands: unknown[] = [];
    await page.route(`**/api/platforms/${provider}`, async (route) => {
      if (route.request().method() === 'GET') return route.fulfill({ json: { data: state } });
      const body = route.request().postDataJSON() as { command: unknown };
      commands.push(body.command);
      state = {
        ...state,
        connection: { generation: 2, status: 'connected' },
        task: {
          id: `daily-${String(commands.length)}`,
          status: 'running',
          error: null,
          progress: {
            stage: 'list',
            total: null,
            processed: 0,
            saved: 0,
            skipped: 0,
            failure: null,
          },
        },
      };
      return route.fulfill({ status: 202, json: { data: { taskId: state.task?.id } } });
    });
    // 1、进入和筛选只读本地数据；高级参数默认不可见。
    await page.goto(`/jobs?source=platform&provider=${provider}&q=existing-filter`);
    await expect(page.getByLabel('调试描述文件绝对路径')).not.toBeVisible();
    await expect(page.getByLabel('目标标签页 ID')).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: '选择平台页面' })).toHaveCount(0);
    await expect(page.getByText(/由 Worker 新建专用标签页/)).toBeVisible();
    await expect(page.getByRole('button', { name: '获取职位', exact: true })).toBeDisabled();
    expect(commands).toEqual([]);
    await page.getByRole('checkbox', { name: /允许自动连接/ }).check();
    await page.getByRole('button', { name: '获取职位', exact: true }).click();
    await expect(page.getByRole('button', { name: '获取职位', exact: true })).toBeDisabled();
    await expect.poll(() => commands).toEqual([{ action: 'acquire', generation: null }]);
    // 2、完成后只刷新本地结果，不发布第二个任务；下一次点击携带当前代次。
    state = {
      ...state,
      connection: { generation: 2, status: 'available' },
      task: {
        id: 'daily-1',
        status: 'succeeded',
        error: null,
        progress: {
          stage: 'complete',
          total: 2,
          processed: 2,
          saved: 2,
          skipped: 0,
          failure: null,
        },
      },
    };
    await expect(page.getByText('已入库 2 条', { exact: false })).toBeVisible({ timeout: 10000 });
    await expect(page).toHaveURL(new RegExp(`provider=${provider}&q=existing-filter`));
    expect(commands).toHaveLength(1);
    await page.getByRole('button', { name: '获取职位', exact: true }).click();
    await expect.poll(() => commands[1]).toEqual({ action: 'acquire', generation: 2 });
  });
}

test('连接失败可原地重试，不选择已有页面，窄屏键盘可操作', async ({ page }) => {
  let state: WebBossSnapshot = { connection: null, batch: null, saved: {}, task: null };
  const commands: unknown[] = [];
  await page.route('**/api/platforms/boss', async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { data: state } });
    commands.push((route.request().postDataJSON() as { command: unknown }).command);
    state = {
      connection: { generation: 3, status: 'unavailable' },
      batch: null,
      saved: {},
      task: {
        id: 'missing-browser',
        status: 'failed',
        error: '未找到 Chrome 调试连接。请在本机 Chrome 启用远程调试。',
        progress: {
          stage: 'connect',
          total: null,
          processed: 0,
          saved: 0,
          skipped: 0,
          failure: {
            category: 'session_unavailable',
            reason: 'browser_not_found',
            businessCode: null,
          },
        },
      },
    };
    return route.fulfill({ status: 202, json: { data: { taskId: 'missing-browser' } } });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/jobs?source=platform&provider=boss');
  await page.getByRole('checkbox', { name: /允许自动连接/ }).check();
  await page.getByRole('button', { name: '获取职位', exact: true }).click();
  await expect(page.getByText('未找到 Chrome 调试连接。', { exact: false })).toBeVisible({
    timeout: 10000,
  });
  await expect(page.getByRole('combobox', { name: '选择平台页面' })).toHaveCount(0);
  await page.getByRole('button', { name: '获取职位', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => commands[1]).toEqual({ action: 'acquire', generation: 3 });
  state = {
    ...state,
    targets: [],
    task: {
      id: 'missing-browser',
      status: 'failed',
      error: '未找到 Chrome 调试连接。请在本机 Chrome 启用远程调试。',
      progress: {
        stage: 'connect',
        total: null,
        processed: 0,
        saved: 0,
        skipped: 0,
        failure: {
          category: 'session_unavailable',
          reason: 'browser_not_found',
          businessCode: null,
        },
      },
    },
  };
  await expect(page.getByText('未找到 Chrome 调试连接。', { exact: false })).toBeVisible({
    timeout: 10000,
  });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/platform-daily-mobile.png', fullPage: true });
  expect(commands).toHaveLength(2);
});
