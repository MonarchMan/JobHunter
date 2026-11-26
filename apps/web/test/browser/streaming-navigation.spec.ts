import { expect, test } from '@playwright/test';

test('job list and detail show the target before delayed data', async ({ page }) => {
  await page.goto('/');
  const origin = await page.evaluate(() => performance.timeOrigin);
  await page.setExtraHTTPHeaders({ 'x-jobhunter-test-delay-section': 'jobs' });
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('link', { name: '职位' })
    .click();
  await expect(page.getByRole('status', { name: '正在加载职位列表' })).toBeVisible({
    timeout: 45_000,
  });
  await expect(page.getByRole('heading', { name: '职位列表' })).toBeVisible();
  const detail = page.getByRole('link', { name: '查看职位详情：AI 产品实习生' });
  await expect(detail).toHaveCount(0);
  await expect(detail).toBeVisible();

  await page.setExtraHTTPHeaders({ 'x-jobhunter-test-delay-section': 'job-detail' });
  await detail.click();
  await expect(page.getByRole('status', { name: '正在加载职位详情' })).toBeVisible({
    timeout: 45_000,
  });
  await expect(page.getByRole('heading', { name: '职位详情', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '职位描述' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'AI 产品实习生' })).toBeVisible();
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(origin);
});

test('usage tab becomes current before the delayed report is shown', async ({ page }) => {
  await page.goto('/tasks');
  await expect(page.getByRole('heading', { name: '后台任务' })).toBeVisible();
  await page.setExtraHTTPHeaders({ 'x-jobhunter-test-delay-section': 'usage' });
  const tabs = page.getByRole('navigation', { name: '任务视图' });
  await tabs.getByRole('link', { name: '用量统计' }).click();
  await expect(page.getByRole('status', { name: '正在加载用量统计' })).toBeVisible({
    timeout: 45_000,
  });
  await expect(tabs.getByRole('link', { name: '用量统计' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.getByRole('heading', { name: '后台任务' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '成本', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '成本', exact: true })).toBeVisible();
});

test('settings preferences are usable before the delayed mailbox arrives', async ({ page }) => {
  await page.goto('/jobs');
  await page.setExtraHTTPHeaders({ 'x-jobhunter-test-delay-section': 'mailbox' });
  const nav = page.getByRole('navigation', { name: '主导航' });
  await nav.getByRole('link', { name: '设置', exact: true }).click();
  await expect(page.getByRole('status', { name: '正在加载邮箱连接' })).toBeVisible({
    timeout: 45_000,
  });
  await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '保存设置' })).toBeEnabled();
  const mailbox = page.getByRole('button', { name: '添加邮箱连接' });
  await expect(mailbox).toHaveCount(0);
  await expect(mailbox).toBeVisible();
});
