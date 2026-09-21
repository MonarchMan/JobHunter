import { expect, test } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

/** 任务诊断入口和类型筛选共用四平台名称，不遗漏后接入的平台。 */
test('任务类型筛选完整覆盖四个平台', async ({ page }) => {
  // 1、检查真实下拉选项，再提交猎聘范围；该页面只查询本地队列。
  await page.goto('/tasks');
  await page.getByRole('combobox', { name: '类型', exact: true }).click();
  for (const name of ['BOSS 平台浏览', '智联平台浏览', '前程无忧官网辅助浏览', '猎聘平台浏览']) {
    await expect(page.getByRole('option', { name, exact: true })).toBeVisible();
  }
  await expect(page.getByRole('option', { name: '智联校园浏览', exact: true })).toHaveCount(0);
  await page.getByRole('option', { name: '猎聘平台浏览', exact: true }).click();
  await page.getByRole('button', { name: '应用筛选', exact: true }).click();
  await expect(page).toHaveURL(/type=platform.liepin/);
  await expect(page.getByRole('combobox', { name: '类型', exact: true })).toHaveText(
    '猎聘平台浏览',
  );
});

/** 合成本地状态覆盖批次进度、失败保留与断线，不访问任何招聘网站。 */
test('平台进度与错误可读，断线禁用采集，窄屏和键盘保留诊断入口', async ({ page }) => {
  const progress = {
    stage: 'detail',
    total: 24,
    processed: 1,
    saved: 1,
    skipped: 3,
    failure: null as object | null,
  };
  const state = {
    connection: { generation: 1, status: 'available' },
    batch: null,
    saved: {},
    task: {
      id: '018f0000-0000-7000-8000-000000000999',
      status: 'running',
      error: null as string | null,
      progress,
    },
  };
  let posts = 0;
  await page.route('**/api/platforms/liepin', async (route) => {
    if (route.request().method() === 'POST') posts++;
    return route.fulfill({ json: { data: state } });
  });
  await page.goto('/sources?channel=platform&provider=liepin');
  await expect(page.getByText('有效候选 24 条', { exact: false })).toBeVisible();
  await expect(page.getByText('后台正在处理本批职位，无需刷新官网页面。')).toBeVisible();
  await expect(page.getByRole('button', { name: '获取职位' })).toBeDisabled();
  state.task.status = 'failed';
  state.task.error =
    '职位数据格式或身份校验未通过，已停止请求。请保留任务编号供排查，无需反复登录。';
  progress.failure = { category: 'parse_changed', businessCode: 123, reason: 'detail_identity' };
  state.connection.status = 'unavailable';
  await expect(page.getByText('原因码：detail_identity', { exact: false })).toBeVisible({
    timeout: 10000,
  });
  await expect(page.getByText('已入库 1 条', { exact: false })).toBeVisible();
  await expect(page.getByText('连接不可用', { exact: true })).toBeVisible();
  await expect(page.getByText('高级连接设置', { exact: true }).locator('..')).not.toHaveAttribute(
    'open',
  );
  await page.getByRole('link', { name: '查看平台职位' }).focus();
  await expect(page.getByRole('link', { name: '查看平台职位' })).toBeFocused();
  for (const width of [1280, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const platformLinks = page.getByRole('navigation', { name: '招聘平台选择' }).getByRole('link');
    await expect(platformLinks).toHaveCount(4);
    for (const link of await platformLinks.all()) {
      const box = await link.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(40);
      expect(box?.width).toBeGreaterThanOrEqual(140);
    }
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: `test-results/platform-progress-${String(width)}.png`,
      fullPage: true,
    });
  }
  state.task.status = 'cancelled';
  progress.failure = { category: 'cancelled', businessCode: null, reason: null };
  await expect(page.getByText('类别：cancelled', { exact: false })).toBeVisible({ timeout: 10000 });
  expect(posts).toBe(0);
});
