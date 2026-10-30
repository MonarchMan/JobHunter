import { expect, test } from '@playwright/test';

for (const route of ['/jobs', '/tasks']) {
  test(`table uses page vertical scrolling on ${route}`, async ({ page }) => {
    // 1、使用桌面表格仍可见的窄视口，覆盖横向溢出和页面纵向滚动。
    await page.setViewportSize({ width: 1000, height: 500 });
    await page.goto(route);
    const table = page.locator('table').first();
    const container = table.locator('..');
    await expect(table).toBeVisible();
    await expect(container).toHaveCSS('overflow-x', 'auto');
    await expect(container).toHaveCSS('overflow-y', 'hidden');
    await expect(container).toHaveCSS('scrollbar-gutter', 'auto');
    expect(
      await container.evaluate((element) => element.scrollHeight - element.clientHeight),
    ).toBeLessThanOrEqual(1);

    // 2、表格内的纵向滚轮由页面处理，不改变表格自身的纵向位置。
    await container.evaluate((element) => {
      window.scrollTo(0, window.scrollY + element.getBoundingClientRect().top - 80);
    });
    const before = await page.evaluate(() => window.scrollY);
    expect(before).toBeGreaterThan(0);
    const bounds = await container.boundingBox();
    if (!bounds) throw new Error('表格容器不可见');
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 40);
    await page.mouse.wheel(0, -200);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(before);
    expect(await container.evaluate((element) => element.scrollTop)).toBe(0);

    // 3、列宽超出时仍能横向浏览，页面本身不产生横向溢出。
    const overflow = await container.evaluate((element) => {
      element.scrollLeft = 200;
      return { width: element.scrollWidth - element.clientWidth, left: element.scrollLeft };
    });
    if (overflow.width > 0) expect(overflow.left).toBeGreaterThan(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      1000,
    );
  });
}
