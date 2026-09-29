import { expect, test } from '@playwright/test';

test('navigation and tables use the approved purple palette without changing selection', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/jobs');
  const active = page.locator('nav a[aria-current="page"]').first();
  await expect(active).toHaveCSS('background-color', 'rgb(237, 231, 246)');
  await expect(active).toHaveCSS('color', 'rgb(91, 52, 122)');
  await expect(active.locator('svg')).toHaveCSS('color', 'rgb(91, 52, 122)');
  const toolbar = page.locator('[class*="selectionToolbar"]').first();
  await expect(toolbar).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(page.locator('thead th').first()).toHaveCSS(
    'background-color',
    'rgb(243, 240, 247)',
  );
  await expect(page.locator('thead th').first()).toHaveCSS('color', 'rgb(98, 86, 111)');
  const row = page.locator('tbody tr').first();
  await row.hover();
  await expect(row).toHaveCSS('background-color', 'rgb(248, 246, 251)');
  const checkbox = row.getByRole('checkbox');
  await checkbox.check();
  await expect(toolbar).toContainText('已选择 1 项');
  await checkbox.uncheck();
  await expect(toolbar).toContainText('已选择 0 项');
  await page.screenshot({ path: testInfo.outputPath('desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(active).toBeVisible();
  await expect(active).toHaveCSS('background-color', 'rgb(237, 231, 246)');
  await page.screenshot({ path: testInfo.outputPath('mobile.png'), fullPage: true });
  await page.goto('/tasks');
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.locator('thead th').first()).toHaveCSS(
    'background-color',
    'rgb(243, 240, 247)',
  );
});
