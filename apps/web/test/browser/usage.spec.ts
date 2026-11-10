import { expect, test } from '@playwright/test';

test('usage tab shares filters across totals, charts, models and paginated logs', async ({
  page,
}) => {
  await page.goto('/tasks');
  await page.getByRole('link', { name: '用量统计', exact: true }).click();
  await expect(page.getByText('$0.09', { exact: true })).toBeVisible();
  await expect(page.getByText(/次请求未定价/)).toHaveCount(0);
  await expect(page.locator('[title*="次请求未定价"]')).toHaveCount(0);
  await expect(page.getByRole('cell', { name: 'network-failed-fixture', exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByRole('combobox', { name: '币种', exact: true })).toHaveText('USD · 美元');
  await expect(
    page.getByRole('cell', { name: 'deepseek-fixture-model', exact: true }),
  ).toBeVisible();
  await expect(page.locator('select:visible')).toHaveCount(0);
  await expect(page.getByRole('columnheader')).toHaveText([
    '时间',
    '应用',
    '供应商',
    '模型',
    '新增输入',
    '输出',
    '缓存命中',
    '成本',
    '速度 ?',
    '首字 ?',
  ]);
  await expect(page.getByRole('cell', { name: '50 tok/s', exact: true }).first()).toBeVisible();
  await expect(page.getByText('79.6%', { exact: true })).toBeVisible();
  await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(20);
  await expect(page.getByRole('combobox', { name: '时间范围' })).toBeVisible();
  await page.getByRole('combobox', { name: '供应商', exact: true }).click();
  await page.getByRole('option', { name: 'api.example.test', exact: true }).click();
  await page.getByRole('combobox', { name: '模型', exact: true }).click();
  await page.getByRole('option', { name: 'usage-fixture-model', exact: true }).click();
  await expect(page).toHaveURL(/model=usage-fixture-model/);
  await page.getByRole('combobox', { name: '供应商', exact: true }).click();
  await page.getByRole('option', { name: '供应商', exact: true }).click();
  await expect(page.getByRole('combobox', { name: '模型', exact: true })).toHaveText('模型');
  // 同一轮页面验收会生成其他合成调用；分页断言只统计本测试的 28 条固定账单。
  await page.getByRole('combobox', { name: '模型', exact: true }).click();
  await page.getByRole('option', { name: 'usage-fixture-model', exact: true }).click();
  await page.getByRole('button', { name: '更多指标' }).click();
  await expect(page.getByText('Output', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '更多指标' }).click();
  await page.getByRole('button', { name: '成本', exact: true }).click();
  await expect(page.getByRole('button', { name: '成本', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('link', { name: '下一页', exact: true }).click();
  await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(8);
  await expect(page.getByText('$0.08', { exact: true })).toBeVisible();
  await page
    .getByRole('navigation', { name: '统计明细' })
    .getByRole('link', { name: '模型', exact: true })
    .click();
  await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(1);
  await page
    .getByRole('navigation', { name: '统计明细' })
    .getByRole('link', { name: '供应商', exact: true })
    .click();
  await expect(page.getByRole('cell', { name: 'api.example.test', exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader')).toHaveText([
    '供应商',
    '请求数',
    'Tokens',
    '成本',
    '成功率',
    '速度 ?',
    '首字 ?',
  ]);
  await expect(page.getByRole('combobox', { name: '状态码' })).toHaveCount(0);
  await page
    .getByRole('navigation', { name: '统计明细' })
    .getByRole('link', { name: '请求日志', exact: true })
    .click();
  await page.setViewportSize({ width: 1600, height: 1000 });
  // 确认客户端下拉框完成 hydration 后截图，避免截图的 caret 样式干扰首屏 hydration。
  await page.getByRole('combobox', { name: '状态码' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await page.screenshot({ path: '../../var/research/usage-desktop.png', fullPage: true });
  await page
    .getByRole('navigation', { name: '统计明细' })
    .getByRole('link', { name: '设置', exact: true })
    .click();
  await expect(
    page.getByRole('table', { name: '模型定价' }).getByRole('cell', { name: '$5.00', exact: true }),
  ).toHaveCount(2);
  await page.getByRole('combobox', { name: '趋势图样式' }).click();
  await page.getByRole('option', { name: '折线图', exact: true }).click();
  await expect(page.locator('svg[aria-label="折线图"]')).toBeVisible();
  await page.getByRole('combobox', { name: '请求日志的列' }).click();
  await page.getByRole('option', { name: '总耗时', exact: true }).click();
  await page.getByRole('option', { name: '显示', exact: true }).click();
  await expect(page).toHaveURL(/duration/);
  await page
    .getByRole('navigation', { name: '统计明细' })
    .getByRole('link', { name: '请求日志', exact: true })
    .click();
  await expect(page.getByRole('columnheader', { name: '总耗时', exact: true })).toBeVisible();
  await page
    .getByRole('navigation', { name: '统计明细' })
    .getByRole('link', { name: '设置', exact: true })
    .click();
  await page.getByRole('combobox', { name: '币种', exact: true }).click();
  await page.getByRole('option', { name: 'CNY · 人民币', exact: true }).click();
  await expect(page).toHaveURL(/currency=CNY/);
  await page.getByRole('combobox', { name: '模型', exact: true }).click();
  await page.getByRole('option', { name: '模型', exact: true }).click();
  await page
    .getByRole('navigation', { name: '统计明细' })
    .getByRole('link', { name: '请求日志', exact: true })
    .click();
  await expect(
    page.getByRole('cell', { name: 'deepseek-fixture-model', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('cell', { name: '321', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: '¥0.0120', exact: true })).toBeVisible();
});

test('display currency converts all costs without hiding requests or changing Tokens', async ({
  page,
}) => {
  await page.goto('/tasks?tab=usage');
  const requests = page.locator('article').filter({ hasText: '总请求数' }).locator('strong');
  const tokens = page.locator('article').filter({ hasText: '真实消耗 Tokens' }).locator('strong');
  const requestText = await requests.innerText();
  const tokenText = await tokens.innerText();
  await page.getByRole('button', { name: '成本', exact: true }).click();
  await page.getByRole('combobox', { name: '币种', exact: true }).click();
  await page.getByRole('option', { name: 'CNY · 人民币', exact: true }).click();
  await expect(page.getByText('¥0.62', { exact: true })).toBeVisible();
  await expect(requests).toHaveText(requestText);
  await expect(tokens).toHaveText(tokenText);
  await expect(page.getByText('成本 · CNY', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('cell', { name: 'deepseek-fixture-model', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('cell', { name: 'usage-fixture-model', exact: true }).first(),
  ).toBeVisible();
});

test('usage is readable on mobile and chart data supports keyboard focus', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/tasks?tab=usage');
  const bar = page.getByRole('region', { name: '使用趋势' }).getByRole('button').nth(3);
  await bar.focus();
  await expect(bar).toBeFocused();
  await page.getByRole('combobox', { name: '状态码' }).click();
  await page.getByRole('option', { name: '200', exact: true }).click();
  await expect(page).toHaveURL(/statusCode=200/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '../../var/research/usage-mobile.png', fullPage: true });
  await page.getByRole('link', { name: '任务与Agent', exact: true }).click();
  await expect(page.getByRole('heading', { name: '后台任务', exact: true })).toBeVisible();
});
