import { expect, test } from '@playwright/test';

test('shows per-request usage and cost with one value per cell', async ({ page }) => {
  // 1、仅替换详情接口的合成计费字段，覆盖真实弹窗与空值展示。
  await page.route('**/api/agent-runs/*', async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { data: Record<string, unknown> };
    body.data.billingCalls = [
      {
        model: 'deepseek-flash',
        requestedAt: Date.parse('2026-10-30T14:49:41Z'),
        inputTokens: 1000,
        outputTokens: 100,
        cacheReadTokens: 0,
        cacheWriteTokens: null,
        uncachedInputTokens: 1000,
        inputCostMicros: 150,
        outputCostMicros: 60,
        cacheReadCostMicros: 0,
        cacheWriteCostMicros: 0,
        totalCostMicros: 210,
        currency: 'USD',
        pricingVersion: 'deepseek-test-off-peak',
        period: 'off-peak',
        precision: 'reported',
        rates: null,
      },
      {
        model: 'kimi-k3',
        requestedAt: Date.parse('2026-11-01T12:00:00Z'),
        inputTokens: 2000,
        outputTokens: 100,
        cacheReadTokens: 600,
        cacheWriteTokens: 1000,
        uncachedInputTokens: 400,
        cacheWrite5mTokens: 400,
        cacheWrite1hTokens: 600,
        inputCostMicros: 8000,
        outputCostMicros: 10000,
        cacheReadCostMicros: 1200,
        cacheWriteCostMicros: 32000,
        cacheWrite5mCostMicros: 8000,
        cacheWrite1hCostMicros: 24000,
        totalCostMicros: 51200,
        currency: 'CNY',
        pricingVersion: 'catalog-test',
        period: 'fixed',
        precision: 'reported',
        rates: null,
      },
    ];
    await route.fulfill({ response, json: body });
  });
  await page.goto('/tasks?range=all');
  await page
    .locator('[data-agent-section]')
    .getByRole('button', { name: '职位分析', exact: true })
    .click();
  const section = page.getByRole('region', { name: '请求用量与费用' });
  await expect(section.getByRole('columnheader', { name: '时间' })).toBeVisible();
  await expect(section.getByRole('columnheader', { name: '模型' })).toBeVisible();
  await expect(section.getByRole('columnheader', { name: '输入' })).toBeVisible();
  await expect(section.getByRole('columnheader', { name: '输出' })).toBeVisible();
  await expect(section.getByRole('columnheader', { name: '成本' })).toBeVisible();
  const rows = section.getByRole('row');
  await expect(rows).toHaveCount(3);
  const first = rows.nth(1).getByRole('cell');
  await expect(first.nth(0)).toHaveText('22:49:41');
  await expect(first.nth(0)).toHaveAttribute('title', '2026/10/30 22:49:41');
  await expect(first.nth(1)).toHaveText('deepseek-flash');
  await expect(first.nth(2)).toHaveText('1000');
  await expect(first.nth(3)).toHaveText('100');
  await expect(first.nth(4)).toHaveText('$0.000210');
  const second = rows.nth(2).getByRole('cell');
  await expect(second.nth(0)).toHaveText('20:00:00');
  await expect(second.nth(1)).toHaveText('kimi-k3');
  await expect(second.nth(2)).toHaveText('2000');
  await expect(second.nth(3)).toHaveText('100');
  await expect(second.nth(4)).toHaveText('¥0.051200');
  // 表格不超出弹窗宽度，横向无需滚动。
  const dialogBox = await page.locator('dialog').boundingBox();
  const tableBox = await section.locator('table').boundingBox();
  expect(dialogBox).not.toBeNull();
  expect(tableBox).not.toBeNull();
  if (dialogBox && tableBox) expect(tableBox.width).toBeLessThanOrEqual(dialogBox.width);
  // 2、窄屏仍能读取明细，横向溢出限定在表格内部。
  await page.setViewportSize({ width: 390, height: 844 });
  // 移动端独立进入页面，再从卡片打开详情。
  await page.goto('/tasks?range=all');
  await page.getByRole('button', { name: '职位分析', exact: true }).click();
  await expect(section.getByRole('heading')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
