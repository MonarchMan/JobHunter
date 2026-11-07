import { expect, test } from '@playwright/test';

test('number field keeps form submission, keyboard stepping and limits', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto('/jobs');
  await page.locator('summary').filter({ hasText: '筛选职位' }).click();
  const input = page.getByRole('spinbutton', { name: '最低分', exact: true });
  const up = page.getByRole('button', { name: '增加最低分', exact: true });
  const down = page.getByRole('button', { name: '减少最低分', exact: true });
  await input.fill('99');
  await up.click();
  await expect(input).toHaveValue('100');
  await expect(up).toBeDisabled();
  await down.click();
  await expect(input).toHaveValue('99');
  await input.press('ArrowUp');
  await expect(input).toHaveValue('100');
  await input.fill('0');
  await expect(down).toBeDisabled();
  await input.fill('');
  await expect(input).toHaveValue('');
  await expect(up).toBeEnabled();
  await up.click();
  await expect(input).not.toHaveValue('');
  await expect(input).toHaveCSS('appearance', 'textfield');
  await input.fill('42');
  await input.locator('../..').screenshot({ path: test.info().outputPath('number-field.png') });
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await expect(page).toHaveURL(/minScore=42/);
  await expect(input).toHaveValue('42');
});

test('controlled number fields update parent state and preserve decimal steps', async ({
  page,
}) => {
  await page.goto('/profile?profile=018f0000-0000-7000-8000-000000000621');
  const months = page.getByRole('spinbutton', { name: '可持续实习月数', exact: true });
  await months.fill('1.5');
  await page.getByRole('button', { name: '增加可持续实习月数', exact: true }).click();
  await expect(months).toHaveValue('2');
  await page.getByRole('button', { name: '减少可持续实习月数', exact: true }).click();
  await expect(months).toHaveValue('1.5');
  const year = page.getByRole('spinbutton', { name: '毕业届别（年份）', exact: true });
  await year.fill('1900');
  await expect(
    page.getByRole('button', { name: '减少毕业届别（年份）', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: '增加毕业届别（年份）', exact: true }).click();
  await expect(year).toHaveValue('1901');
  await months.fill('');
  await expect(months).toHaveValue('');
});
