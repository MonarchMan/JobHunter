import { expect, test } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { webSettingsMutationSchema, webSettingsSchema } from '@jobhunter/application/web';

/** 校验设置响应并读取持久化的评分开关，避免用未经检查的测试数据断言。 */
async function storedScoring(response: { json(): Promise<unknown> }): Promise<boolean> {
  // 1. 复用生产边界 Schema，确保测试读取的是布尔配置而非字符串或缺失字段。
  const body = (await response.json()) as { data: unknown };
  return webSettingsSchema.parse(body.data).matchingAutomation.scoreEnabled;
}

for (const width of [1280, 390]) {
  test(`automatic scoring checkbox persists its checked value at ${String(width)}px`, async ({
    page,
  }) => {
    // 1. 在隔离夹具中验证 UI、提交值与重载值，不触发真实来源同步。
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/settings');
    await expect(page.getByText(/修改后请点击“保存设置”/)).toBeVisible();
    const scoring = page.getByRole('checkbox', { name: /^同步后自动评分/ });
    const advice = page.getByRole('checkbox', { name: /^自动生成求职建议/ });
    const save = page.getByRole('button', { name: '保存设置', exact: true });
    for (const enabled of [false, true]) {
      const before = await page.request.get('/api/settings');
      const persistedBefore = await storedScoring(before);
      if (enabled) {
        await scoring.focus();
        await scoring.press('Space');
      } else await scoring.setChecked(enabled);
      await expect(scoring).toBeChecked({ checked: enabled });
      if (enabled) await expect(advice).toBeEnabled();
      else await expect(advice).toBeDisabled();
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
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: `../../var/settings-scoring-${String(width)}.png`,
      fullPage: true,
    });
  });
}
