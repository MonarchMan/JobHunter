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
    const toggle = steps.getByRole('button', { name: '展开引导' });
    await expect(toggle).toHaveText('');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toHaveCSS('border-top-style', 'solid');
    await expect(toggle).toHaveCSS('border-top-width', '1px');
    await expect(toggle.locator('svg path')).toHaveAttribute('d', 'm6 9 6 6 6-6');
    const headingBox = await steps.getByRole('heading').boundingBox();
    const toggleBox = await toggle.boundingBox();
    if (!headingBox || !toggleBox) throw new Error('Missing setup controls');
    expect(toggleBox.x).toBeGreaterThan(headingBox.x + headingBox.width);
    expect(toggleBox.x - headingBox.x - headingBox.width).toBeLessThan(20);
    expect(
      Math.abs(toggleBox.y + toggleBox.height / 2 - headingBox.y - headingBox.height / 2),
    ).toBeLessThan(2);
    await toggle.click();
    await expect(steps.locator('ol')).toBeVisible();
    await expect(
      steps.getByRole('button', { name: '收起引导' }).locator('svg path'),
    ).toHaveAttribute('d', 'm6 15 6-6 6 6');
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
