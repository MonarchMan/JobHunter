import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

for (const width of [1280, 768]) {
  for (const route of ['/', '/jobs', '/profile', '/sources', '/tasks']) {
    test(`${route} has no accessibility violations at ${String(width)}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(route);
      await expect(page.locator('h1')).toHaveCount(1);
      await expect(page.locator('html')).toHaveJSProperty('scrollWidth', width);
      const result = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      expect(result.violations).toEqual([]);
    });
  }
}

test('filter controls and diagnostic tables expose semantic names', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 900 });
  await page.goto('/jobs');
  await expect(page.getByRole('form', { name: '职位筛选' })).toBeVisible();
  await expect(page.getByLabel('关键词')).toBeVisible();
  await expect(page.getByLabel('最低分')).toBeVisible();

  await page.goto('/tasks');
  for (const caption of ['后台任务列表', 'Agent 运行列表']) {
    await expect(page.getByRole('table', { name: caption })).toBeVisible();
  }
});

test('keyboard can skip navigation, filter jobs and return to the list', async ({ page }) => {
  await page.goto('/jobs');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: '跳到主要内容' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();

  await page.getByLabel('关键词').fill('Agent');
  await page.getByRole('button', { name: '应用筛选' }).press('Enter');
  await expect(page).toHaveURL(/q=Agent/);
  await expect(page.getByRole('heading', { name: '职位列表' })).toBeVisible();
  await page.getByRole('link', { name: 'JobHunter' }).focus();
  await expect(page.getByRole('link', { name: 'JobHunter' })).toBeFocused();
});
