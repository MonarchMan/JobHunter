import { expect, test } from '@playwright/test';

for (const width of [1280, 390]) {
  test(`daily dashboard supports persistent setup folding at ${String(width)}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const steps = page.locator('section[aria-labelledby="setup-title"]');
    // 1、已完成初始化的夹具默认收起；用户展开选择在刷新后保留。
    await expect(steps.getByText('初始设置已完成')).toBeVisible();
    await steps.getByRole('button', { name: '展开引导' }).click();
    await expect(steps.locator('ol')).toBeVisible();
    await page.reload();
    await expect(steps.locator('ol')).toBeVisible();
    await steps.getByRole('button', { name: '收起引导' }).click();
    await expect(steps.locator('ol')).toBeHidden();
    // 2、活动板块已移除，窄屏仍不溢出。
    await expect(page.getByRole('heading', { name: '最近活动' })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    const hero = await page.locator('section[aria-labelledby="dashboard-title"]').boundingBox();
    expect(hero?.height).toBeLessThan(350);
    await page.screenshot({ path: testInfo.outputPath('dashboard.png'), fullPage: true });
  });
}
