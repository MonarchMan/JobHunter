import { expect, test } from '@playwright/test';

test('shows cached billing breakdown with unknown cache values kept distinct from zero', async ({
  page,
}) => {
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
  await page.goto('/tasks');
  await page
    .locator('[data-agent-section]')
    .getByRole('button', { name: '职位理解', exact: true })
    .click();
  const section = page.getByRole('region', { name: '缓存用量与分项费用' });
  await expect(section).toContainText('缓存命中 600 · 未命中 1400 · 缓存写入 —');
  await expect(section).toContainText('USD 0.000210');
  await expect(section).toContainText('闲时');
  await expect(section).toContainText('1 小时：600');
  await expect(section).toContainText('CNY 0.051200');
  // 2、窄屏仍能读取明细，横向溢出限定在表格内部。
  await page.setViewportSize({ width: 390, height: 844 });
  // 移动端独立进入页面，再从卡片打开详情。
  await page.goto('/tasks');
  await page.getByRole('button', { name: '职位理解', exact: true }).click();
  await expect(section.getByRole('heading')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
