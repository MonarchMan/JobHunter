import { expect, test } from '@playwright/test';

test('task action is charcoal and retains only the card accent', async ({ page }, testInfo) => {
  await page.goto('/');
  const card = page.locator('section[aria-labelledby="next-action-title"]');
  const action = card.getByRole('link', { name: '查看任务' });
  await expect(card.getByRole('heading', { name: '需要处理' })).toBeVisible();
  await expect(card.locator('[class*="cursorIcon"]')).toHaveCount(0);
  await expect(card.locator('[class*="actionState"]')).toHaveCSS('border-left-width', '3px');
  await expect(action).toHaveCSS('background-color', 'rgb(17, 24, 39)');
  await action.hover();
  await expect(action).toHaveCSS('background-color', 'rgb(0, 0, 0)');
  await page.mouse.move(0, 0);
  await action.focus();
  await expect(action).toBeFocused();
  await expect(action).toHaveAttribute('href', /\/tasks/);
  await page.screenshot({ path: testInfo.outputPath('desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(action).toBeVisible();
  await expect(action).toHaveCSS('background-color', 'rgb(17, 24, 39)');
  await action.click();
  await expect(page).toHaveURL(/\/tasks/);
});
