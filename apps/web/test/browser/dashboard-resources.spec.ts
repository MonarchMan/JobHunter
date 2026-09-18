import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/** 固定资源名单独立于实现，防止外链丢失、误改或增加跟踪参数。 */
const expectedResources = [
  ['小林 coding', 'https://xiaolincoding.com/'],
  ['JavaGuide', 'https://javaguide.cn/'],
  ['阿秀的学习笔记', 'https://www.interviewguide.cn/'],
  ['面试鸭', 'https://www.mianshiya.com/'],
  ['代码随想录', 'https://programmercarl.com/'],
  ['Hello 算法', 'https://www.hello-algo.com/'],
  ['力扣', 'https://leetcode.cn/'],
  ['牛客', 'https://www.nowcoder.com/'],
] as const;

for (const width of [1280, 768, 390]) {
  test(`面试充电站安全外链与响应式 ${String(width)}px`, async ({ page, context }) => {
    // 1. 从真实工作台验证固定名单、完整文案和窄屏布局。
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    const panel = page.getByRole('region', { name: '面试充电站' });
    await panel.scrollIntoViewIfNeeded();
    await expect(panel.getByRole('link')).toHaveCount(8);
    for (const [name, href] of expectedResources) {
      const link = panel.getByRole('link', { name: new RegExp(name) });
      await expect(link).toHaveAttribute('href', href);
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      await expect(link).toBeVisible();
      const logo = link.locator('img');
      await expect(logo).toHaveAttribute('src', /^\/assets\/interview-resources\//);
      await expect(logo).toHaveAttribute('alt', '');
      await expect(logo).toHaveJSProperty('complete', true);
      expect(await logo.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(
        0,
      );
      await expect(logo).toHaveCSS('object-fit', 'contain');
    }
    await expect(page.locator('html')).toHaveJSProperty('scrollWidth', width);
    expect(
      (await new AxeBuilder({ page }).include('[aria-labelledby="resources-title"]').analyze())
        .violations,
    ).toEqual([]);
    await panel.screenshot({ path: `../../var/qa/dashboard-resources-${String(width)}.png` });

    // 2. 拦截外站响应，验证键盘新标签行为而不依赖第三方网络。
    await context.route('https://xiaolincoding.com/**', (route) =>
      route.fulfill({ body: '<title>资源测试</title>' }),
    );
    const first = panel.getByRole('link').first();
    await first.focus();
    await expect(first).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(panel.getByRole('link').nth(1)).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    const popupPromise = page.waitForEvent('popup');
    await page.keyboard.press('Enter');
    const popup = await popupPromise;
    await popup.waitForLoadState();
    expect(popup.url()).toBe('https://xiaolincoding.com/');
    expect(await popup.evaluate(() => window.opener === null)).toBe(true);
    expect(await popup.evaluate(() => document.referrer)).toBe('');
    await popup.close();
    await expect(panel).toBeVisible();
  });
}
