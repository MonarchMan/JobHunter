import { expect, test } from '@playwright/test';

test('distinguishes loading details from aggregate usage without request records', async ({
  page,
}) => {
  const delivery = { release: (): void => undefined };
  const ready = new Promise<void>((resolve) => {
    delivery.release = resolve;
  });
  await page.route('**/api/agent-runs/*', async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { data: Record<string, unknown> };
    body.data.billingCalls = [];
    body.data.requestIds = [];
    body.data.inputTokens = 100;
    body.data.outputTokens = 20;
    await ready;
    await route.fulfill({ response, json: body });
  });
  await page.goto('/tasks?range=all');
  await page
    .locator('[data-agent-section]')
    .getByRole('button', { name: '职位分析', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Agent 运行详情' });
  try {
    await expect(dialog.getByText('正在加载调用详情……', { exact: true })).toBeVisible();
    await expect(dialog.getByText(/缺少逐请求明细/)).toHaveCount(0);
    delivery.release();
    await expect(
      dialog.getByText('此记录仅有汇总用量，缺少逐请求明细，无法还原真实请求次数。'),
    ).toBeVisible();
    await expect(dialog.getByRole('region', { name: '请求用量与费用' })).toHaveCount(0);
  } finally {
    delivery.release();
  }
});

test('shows per-request usage and cost with one value per cell', async ({ page }) => {
  // 1、仅替换详情接口的合成计费字段，覆盖真实弹窗与空值展示。
  await page.route('**/api/agent-runs/*', async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { data: Record<string, unknown> };
    body.data.billingCalls = [
      {
        model: 'deepseek-flash',
        statusCode: 200,
        failureReason:
          '输出校验未通过：match: unrecognized_keys; remove unexpected fields [dimensions]',
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
  await expect(section).not.toContainText('次实际模型请求');
  await expect(section.getByRole('columnheader', { name: '错误' })).toBeVisible();
  await expect(section.getByRole('columnheader', { name: '时间' })).toBeVisible();
  await expect(section.getByRole('columnheader', { name: '模型' })).toBeVisible();
  await expect(section.getByRole('columnheader', { name: '输入' })).toBeVisible();
  await expect(section.getByRole('columnheader', { name: '输出' })).toBeVisible();
  await expect(section.getByRole('columnheader', { name: '成本' })).toBeVisible();
  const rows = section.getByRole('row');
  await expect(rows).toHaveCount(3);
  const first = rows.nth(1).getByRole('cell');
  await expect(first.nth(0)).toHaveText('22:49:41');
  await expect(first.nth(0).getByRole('group')).toHaveAccessibleName(
    '22:49:41，2026/10/30 22:49:41',
  );
  await expect(first.nth(1)).toHaveText('deepseek-flash');
  await expect(first.nth(2)).toHaveText('1000');
  await expect(first.nth(3)).toHaveText('100');
  await expect(first.nth(4)).toHaveText('$0.000210');
  const error = first.nth(5).getByRole('group', { name: /输出校验未通过/ });
  const preview = error.locator('[aria-hidden="true"]');
  await expect(section.locator('[role="tooltip"]')).toHaveCount(0);
  await expect(preview).toHaveCSS('text-overflow', 'ellipsis');
  expect(await preview.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
  const requestTime = first.nth(0).getByRole('group');
  await page.keyboard.press('Shift');
  await requestTime.focus();
  await expect(requestTime.getByRole('tooltip')).toBeVisible();
  await error.hover();
  await expect(error.getByRole('tooltip')).toContainText(
    '输出校验未通过：match: unrecognized_keys; remove unexpected fields [dimensions]',
  );
  await expect(section.getByRole('tooltip')).toHaveCount(1);
  await expect(error.getByRole('tooltip')).toHaveCSS('color', 'rgb(255, 255, 255)');
  const second = rows.nth(2).getByRole('cell');
  await expect(second.nth(0)).toHaveText('20:00:00');
  await expect(second.nth(1)).toHaveText('kimi-k3');
  await expect(second.nth(2)).toHaveText('2000');
  await expect(second.nth(3)).toHaveText('100');
  await expect(second.nth(4)).toHaveText('¥0.051200');
  await expect(second.nth(5)).toHaveText('—');
  // 表格不超出弹窗宽度，横向无需滚动。
  const tableScroll = section.locator('table').locator('..');
  expect(
    await tableScroll.evaluate((element) => element.scrollWidth - element.clientWidth),
  ).toBeLessThanOrEqual(1);
  // 2、运行成本列区分已知金额与真正未知：已知金额（含 0）直接展示，不被价格版本遮挡。
  // 弹窗打开时自动刷新暂停，列表行稳定可读。
  const agentTable = page.getByRole('table', { name: 'Agent 运行列表' });
  await expect(agentTable.getByRole('row').filter({ hasText: '职位分析' }).first()).toContainText(
    '$0.0010',
  );
  const cancelled = agentTable.getByRole('row').filter({ hasText: '已取消' });
  await expect(cancelled).toContainText('简历画像提取');
  await expect(cancelled).toContainText('$0.0000');
  await expect(cancelled).not.toContainText('未定价');
  // 旧记录合计未知且没有价格版本时保持破折号占位。
  const failed = agentTable.getByRole('row').filter({ hasText: '招聘邮件分析' });
  await expect(failed.getByRole('cell').nth(3)).toHaveText('—');
  await expect(failed).not.toContainText('未定价');
  // 3、窄屏仍能读取明细，横向溢出限定在表格内部。
  await page.setViewportSize({ width: 390, height: 844 });
  // 移动端独立进入页面，再从卡片打开详情。
  await page.goto('/tasks?range=all');
  await page.getByRole('button', { name: '职位分析', exact: true }).click();
  await expect(section.getByRole('heading')).toBeVisible();
  const dialog = page.getByRole('dialog', { name: 'Agent 运行详情' });
  expect(
    await dialog.evaluate((element) => element.scrollWidth - element.clientWidth),
  ).toBeLessThanOrEqual(1);
  await tableScroll.evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
  });
  await expect(section.getByRole('columnheader', { name: '错误' })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

for (const scenario of [
  { status: 200, expected: '历史请求未记录该次失败或纠正的具体原因。' },
  { status: 429, expected: '模型服务返回 HTTP 429。' },
]) {
  test(
    'shows known HTTP errors or explicitly unknown historical reasons, status=' +
      String(scenario.status),
    async ({ page }) => {
      await page.route('**/api/agent-runs/*', async (route) => {
        const response = await route.fetch();
        const body = (await response.json()) as { data: Record<string, unknown> };
        const base = {
          model: 'fixture',
          requestedAt: 1000,
          inputTokens: 1,
          outputTokens: 1,
          cacheReadTokens: null,
          cacheWriteTokens: null,
          uncachedInputTokens: null,
          inputCostMicros: null,
          outputCostMicros: null,
          cacheReadCostMicros: null,
          cacheWriteCostMicros: null,
          totalCostMicros: null,
          currency: 'USD',
          pricingVersion: 'fixture',
          period: 'unknown',
          precision: 'unpriced',
          rates: null,
        };
        body.data.billingCalls = [
          { ...base, statusCode: scenario.status, inputTokens: null, outputTokens: null },
          { ...base, requestedAt: 2000, statusCode: 200 },
        ];
        await route.fulfill({ response, json: body });
      });
      await page.goto('/tasks?range=all');
      await page
        .locator('[data-agent-section]')
        .getByRole('button', { name: '职位分析', exact: true })
        .click();
      const section = page.getByRole('region', { name: '请求用量与费用' });
      await expect(
        section.getByRole('row').nth(1).getByRole('cell').nth(5).getByRole('group', {
          name: scenario.expected,
        }),
      ).toBeVisible();
      await expect(section.getByRole('row').nth(1).getByRole('cell').nth(4)).toHaveText('—');
      await expect(section.getByRole('row').nth(2).getByRole('cell').nth(4)).toHaveText('未定价');
      await expect(section.getByRole('row').nth(2).getByRole('cell').nth(5)).toHaveText('—');
    },
  );
}
