import { expect, test } from '@playwright/test';

test('re-extraction stays pending until selected fields are explicitly confirmed', async ({
  page,
}) => {
  await page.goto('/profile?profile=018f0000-0000-7000-8000-000000000620');
  const review = page.getByRole('region', { name: '提取结果确认' });
  await expect(review).toBeVisible();
  await expect(page.getByRole('heading', { name: '版本 1', exact: true })).toBeVisible();
  await expect(review.getByRole('button', { name: '应用所选字段' })).toBeDisabled();
  await review.locator('summary').filter({ hasText: '专业技能' }).click();
  await review.getByRole('checkbox', { name: '应用专业技能' }).check();
  await review.getByRole('button', { name: '应用所选字段' }).click();
  await expect(page.getByRole('heading', { name: '版本 3', exact: true })).toBeVisible();
  await expect(review).toHaveCount(0);
  const current = await page.request.get(
    '/api/profile?profile=018f0000-0000-7000-8000-000000000620',
  );
  const body = (await current.json()) as {
    data: {
      detail: {
        current: { effective: { professionalSkills: string; selfEvaluation: string | null } };
      };
    };
  };
  expect(body.data.detail.current.effective.professionalSkills).toBe(
    '候选提取：熟练使用 TypeScript',
  );
  expect(body.data.detail.current.effective.selfEvaluation).not.toBe('此字段未选择时不应应用');
});
