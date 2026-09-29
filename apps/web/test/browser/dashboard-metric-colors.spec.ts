import { expect, test } from '@playwright/test';

test('overview metrics keep four distinct accents on desktop and mobile', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  const metrics = page.locator('[aria-label="核心指标"]');
  const expected = [
    'rgb(17, 24, 39)',
    'rgb(124, 58, 237)',
    'rgb(8, 145, 178)',
    'rgb(245, 158, 11)',
  ];
  const cards = metrics.locator('a');
  await expect(cards).toHaveCount(4);
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const [index, color] of expected.entries()) {
      const card = cards.nth(index);
      await expect
        .poll(() =>
          card.evaluate((element) => getComputedStyle(element, '::before').backgroundColor),
        )
        .toBe(color);
      await expect(card).toHaveCSS('background-color', 'rgb(255, 255, 255)');
      await card.hover();
      await expect(card).toHaveCSS('border-top-color', color);
    }
    await metrics.screenshot({ path: testInfo.outputPath(`metrics-${String(width)}.png`) });
  }
});

test('dashboard hero keeps brand, action, and decision colors distinct', async ({
  page,
}, testInfo) => {
  await page.goto('/');

  const hero = page.locator('[aria-labelledby="dashboard-title"]');
  const resultPhrase = hero.locator('h1 em');
  const primaryAction = hero.getByRole('link', { name: '建立个人资料' });
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(hero).toHaveCSS('background-image', 'none');
    await expect(hero).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await expect(resultPhrase).toHaveCSS('color', 'rgb(31, 77, 54)');
    await expect(resultPhrase).toHaveCSS('font-style', 'normal');
    await expect(primaryAction).toHaveCSS('background-color', 'rgb(17, 24, 39)');
    await expect(primaryAction).toHaveCSS('color', 'rgb(255, 255, 255)');
    await hero.screenshot({ path: testInfo.outputPath(`hero-${String(width)}.png`) });
  }

  const sourceLink = page.getByRole('link', { name: '查看来源' });
  await sourceLink.hover();
  await expect(sourceLink).toHaveCSS('color', 'rgb(31, 77, 54)');
});
