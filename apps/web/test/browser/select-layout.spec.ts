import { expect, test } from '@playwright/test';

for (const width of [390, 1280]) {
  test(`dropdown options remain single-line within a ${String(width)}px viewport`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    for (const route of [
      '/jobs?category=internship',
      '/tasks',
      '/settings',
      '/profile',
      '/sources',
      '/interview/research',
    ]) {
      await page.goto(route);
      const triggers = page.locator('[data-authored-select-trigger]');
      for (const trigger of await triggers.all()) {
        if (!(await trigger.isVisible()) || !(await trigger.isEnabled())) continue;
        await trigger.click();
        const popup = page.locator('[data-authored-select-content]');
        await expect(popup).toBeVisible();
        const box = await popup.boundingBox();
        const triggerBox = await trigger.boundingBox();
        expect(Math.abs((box?.x ?? 0) - (triggerBox?.x ?? 0))).toBeLessThanOrEqual(1);
        expect(Math.abs((box?.width ?? 0) - (triggerBox?.width ?? 0))).toBeLessThanOrEqual(1);
        expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
        expect((box?.x ?? width) + (box?.width ?? width)).toBeLessThanOrEqual(width);
        for (const option of await popup.getByRole('option').all()) {
          await expect(option).toHaveCSS('white-space', 'nowrap');
          await expect(option).toHaveCSS(
            'font-size',
            await trigger.evaluate((element) => getComputedStyle(element).fontSize),
          );
          await expect(option).toHaveCSS('text-align', 'left');
          const lines = await option
            .locator('span')
            .first()
            .evaluate((element) => {
              const range = document.createRange();
              range.selectNodeContents(element);
              return new Set(Array.from(range.getClientRects(), (rect) => Math.round(rect.top)))
                .size;
            });
          expect(lines).toBeLessThanOrEqual(1);
        }
        await page.keyboard.press('Escape');
        await expect(popup).toHaveCount(0);
      }
    }
  });
}
