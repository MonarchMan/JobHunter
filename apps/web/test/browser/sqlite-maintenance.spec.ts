import { expect, test } from '@playwright/test';

for (const width of [1280, 390]) {
  test(`maintenance audit is read-only at ${String(width)}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/tasks?taskType=maintenance.sqlite');
    const record =
      width === 1280
        ? page.getByRole('row').filter({ hasText: '数据库空间整理' })
        : page.getByRole('article').filter({ hasText: '数据库空间整理' });
    await expect(record).toContainText('系统自动维护');
    await expect(record.getByRole('button', { name: /重试任务|取消任务/ })).toHaveCount(0);
    const trigger = record.getByRole('button', { name: '数据库空间整理' });
    await trigger.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: '任务详情' });
    await expect(dialog).toContainText('系统自动维护');
    await expect(dialog.getByRole('button', { name: /重试任务|取消任务/ })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    await expect(page.locator('html')).toHaveJSProperty('scrollWidth', width);
  });
}
