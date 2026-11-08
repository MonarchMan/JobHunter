import { expect, test } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { webSettingsMutationSchema, webSettingsSchema } from '@jobhunter/recruitment/contracts/web';

/** 校验设置响应并读取持久化的评分开关，避免用未经检查的测试数据断言。 */
async function storedScoring(response: { json(): Promise<unknown> }): Promise<boolean> {
  // 1. 复用生产边界 Schema，确保测试读取的是布尔配置而非字符串或缺失字段。
  const body = (await response.json()) as { data: unknown };
  return webSettingsSchema.parse(body.data).matchingAutomation.scoreEnabled;
}

for (const width of [1600, 1280, 390]) {
  test(`automatic scoring checkbox persists its checked value at ${String(width)}px`, async ({
    page,
  }) => {
    // 1. 在隔离夹具中验证 UI、提交值与重载值，不触发真实来源同步。
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/settings');
    await expect(page.locator('html')).toHaveJSProperty('scrollWidth', width);
    await expect(page.getByText(/修改后请点击“保存设置”/)).toHaveCount(0);
    await expect(page.locator('input[type="time"]')).toHaveCount(0);
    const frequencyBox = await page
      .getByRole('combobox', { name: '同步频率', exact: true })
      .boundingBox();
    const timeBox = await page.getByRole('group', { name: '执行时间', exact: true }).boundingBox();
    if (!frequencyBox || !timeBox) throw new Error('同步时间控件未显示');
    expect(frequencyBox.height).toBe(32);
    expect(timeBox.height).toBe(32);
    if (width >= 1100) expect(timeBox.y).toBeCloseTo(frequencyBox.y, 0);
    const sync = page.getByRole('checkbox', { name: '定时同步职位', exact: true });
    const wasSyncEnabled = await sync.isChecked();
    await sync.check();
    const frequency = page.getByRole('combobox', { name: '同步频率', exact: true });
    await frequency.click();
    const weekly = page.getByRole('option', { name: '每周一', exact: true });
    const text = weekly.locator('span').first();
    expect(
      await text.evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        const option = element.closest('[role="option"]');
        return (
          option !== null &&
          range.getBoundingClientRect().right <= option.getBoundingClientRect().right - 20
        );
      }),
    ).toBe(true);
    await weekly.click();
    await expect(frequency).toContainText('每周一');
    await frequency.click();
    await page.getByRole('option', { name: '每天', exact: true }).click();
    await sync.setChecked(wasSyncEnabled);
    const workflow = await page
      .getByRole('region', { name: '工作流偏好', exact: true })
      .boundingBox();
    const mailbox = await page.getByRole('region', { name: '邮箱连接', exact: true }).boundingBox();
    if (!workflow || !mailbox) throw new Error('设置卡片未显示');
    if (width >= 1100) {
      expect(mailbox.x).toBeGreaterThan(workflow.x + workflow.width);
      expect(mailbox.y).toBeCloseTo(workflow.y, 0);
    } else {
      expect(mailbox.width).toBeCloseTo(workflow.width, 0);
      expect(mailbox.x).toBeCloseTo(workflow.x, 0);
      expect(mailbox.y).toBeGreaterThan(workflow.y + workflow.height);
    }
    const scoring = page.getByRole('checkbox', { name: /^同步后自动评分/ });
    const advice = page.getByRole('checkbox', { name: /^自动生成求职建议/ });
    const adviceBox = await advice.boundingBox();
    const helpBox = await advice.locator('..').locator('small').boundingBox();
    if (!adviceBox || !helpBox) throw new Error('开关或说明未显示');
    expect(helpBox.x).toBeCloseTo(adviceBox.x, 0);
    expect(helpBox.y).toBeGreaterThan(adviceBox.y + adviceBox.height);
    const save = page.getByRole('button', { name: '保存设置', exact: true });
    for (const enabled of [false, true]) {
      const before = await page.request.get('/api/settings');
      const persistedBefore = await storedScoring(before);
      if (enabled) {
        await scoring.focus();
        await scoring.press('Space');
      } else await scoring.setChecked(enabled);
      await expect(scoring).toBeChecked({ checked: enabled });
      // 建议开关独立于评分开关，任何评分状态下都可切换。
      await expect(advice).toBeEnabled();
      const unsaved = await page.request.get('/api/settings');
      expect(await storedScoring(unsaved)).toBe(persistedBefore);
      const responsePromise = page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/settings') && response.request().method() === 'PATCH',
      );
      await save.click();
      const response = await responsePromise;
      expect(
        webSettingsMutationSchema.parse(response.request().postDataJSON()).automaticScoringEnabled,
      ).toBe(enabled);
      expect(response.ok()).toBe(true);
      expect(await storedScoring(response)).toBe(enabled);
      // 2. 重新读取持久设置，排除仅本地状态更新造成的假成功。
      await page.reload();
      await expect(scoring).toBeChecked({ checked: enabled });
      const stored = await page.request.get('/api/settings');
      expect(await storedScoring(stored)).toBe(enabled);
    }
    // 3. 保存失败时保留本地选择，但持久配置不能伪装为已成功修改。
    await page.route('**/api/settings', async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue();
      await route.fulfill({
        status: 503,
        json: { error: { message: '测试：暂时无法保存设置。' } },
      });
    });
    await scoring.uncheck();
    await save.click();
    await expect(page.getByRole('region', { name: '通知', exact: true })).toContainText(
      '测试：暂时无法保存设置。',
    );
    await expect(scoring).not.toBeChecked();
    await expect(save).toBeEnabled();
    await page.unroute('**/api/settings');
    await page.reload();
    await expect(scoring).toBeChecked();
    await expect(page.locator('html')).toHaveJSProperty('scrollWidth', width);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: `../../var/settings-scoring-${String(width)}.png`,
      fullPage: true,
    });
  });
}
