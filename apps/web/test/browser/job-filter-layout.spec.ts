import { expect, test } from '@playwright/test';

test('job filters fit two rows on desktop and wrap without overflow on mobile', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/jobs?category=internship');
  const form = page.getByRole('form', { name: '职位筛选' });
  const selectBoxes = await Promise.all(
    (await form.locator('[data-authored-select-trigger]').all()).map((control) =>
      control.boundingBox(),
    ),
  );
  expect(new Set(selectBoxes.map((box) => Math.round(box?.y ?? -1))).size).toBe(1);
  const companyBox = await form.locator('input[name="company"]').boundingBox();
  expect(Math.abs((companyBox?.y ?? 0) - (selectBoxes[0]?.y ?? 0))).toBeLessThanOrEqual(1);
  const inputBoxes = await Promise.all(
    ['q', 'location', 'minScore'].map((name) =>
      form.locator(`input[name="${name}"]`).boundingBox(),
    ),
  );
  expect(new Set(inputBoxes.map((box) => Math.round(box?.y ?? -1))).size).toBe(1);
  expect(inputBoxes[0]?.y ?? 0).toBeGreaterThan(selectBoxes[0]?.y ?? 0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
