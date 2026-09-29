import { expect, test } from '@playwright/test';

for (const width of [1280, 390]) {
  test(`job detail shows only current content at ${String(width)}px`, async ({ page }) => {
    // 1、从现有列表读取真实站内入口，验证详情不会遗留空白历史栏。
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/jobs');
    const href = await page.locator('a[data-row-detail-link]').first().getAttribute('href');
    if (!href) throw new Error('Missing fixture detail link');
    await page.goto(href);
    await expect(page.getByRole('heading', { name: '匹配与建议' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '修订时间线' })).toHaveCount(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    // 2、保留既有返回导航及键盘入口，不添加版本切换交互。
    const back = page.getByRole('link', { name: '← 返回职位列表' });
    await page.screenshot({
      path: `../../var/job-current-content-${String(width)}.png`,
      fullPage: true,
    });
    await back.focus();
    await expect(back).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/jobs(?:\?|$)/);
  });
}
