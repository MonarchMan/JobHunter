import { expect, test } from '@playwright/test';

test('task filters place labels beside controls and keep dropdown options on one line', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/tasks');
  for (const name of ['状态', '类型']) {
    const trigger = page.getByRole('combobox', { name, exact: true });
    await expect(trigger.locator('..')).toHaveCSS('display', 'flex');
    await trigger.click();
    const options = page.getByRole('option');
    for (const option of await options.all()) {
      await expect(option).toHaveCSS('white-space', 'nowrap');
    }
    const popup = await page.locator('[data-authored-select-content]').boundingBox();
    expect(popup).not.toBeNull();
    expect((popup?.x ?? 0) + (popup?.width ?? 0)).toBeLessThanOrEqual(390);
    await page.keyboard.press('Escape');
  }
});
