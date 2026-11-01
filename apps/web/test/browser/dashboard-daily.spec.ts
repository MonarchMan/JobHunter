import { expect, test } from '@playwright/test';

for (const width of [1280, 390]) {
  test(`daily dashboard supports activity details and persistent setup folding at ${String(width)}px`, async ({
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
    // 2、活动结果有界且可以查看详情，窄屏不溢出。
    const activity = page.locator('section[aria-labelledby="latest-sync-title"]');
    await expect(activity.getByRole('heading', { name: '最近活动' })).toBeVisible();
    expect(await activity.locator('li').count()).toBeLessThanOrEqual(8);
    await activity.getByRole('button').first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    const hero = await page.locator('section[aria-labelledby="dashboard-title"]').boundingBox();
    expect(hero?.height).toBeLessThan(350);
    await page.screenshot({ path: testInfo.outputPath('dashboard.png'), fullPage: true });
  });
}
