import { expect, test } from '@playwright/test';

test('page size resets the page, survives reload and controls returned sources', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto('/sources?page=2');
  const selector = page.getByRole('combobox', { name: '招聘来源分页每页数量' });
  await selector.click();
  for (const size of [10, 20, 50, 100]) {
    await expect(
      page.getByRole('option', { name: `${String(size)} 条/页`, exact: true }),
    ).toBeVisible();
  }
  await page.getByRole('option', { name: '20 条/页', exact: true }).click();
  await expect(page).toHaveURL(/\/sources\?pageSize=20$/);
  await expect(page.locator('[data-company-source-card]')).toHaveCount(20);
  await page.reload();
  await expect(selector).toContainText('20 条/页');
  await page
    .getByRole('navigation', { name: '招聘来源分页' })
    .getByRole('link', { name: '2', exact: true })
    .click();
  await expect(page).toHaveURL(/page=2&pageSize=20/);
  await expect(selector).toContainText('20 条/页');
});

test('task and agent sizes are independent and retain filters', async ({ page }) => {
  await page.goto('/tasks?status=failed&taskPage=2&agentPageSize=50');
  await page.getByRole('combobox', { name: '后台任务分页每页数量' }).click();
  await page.getByRole('option', { name: '100 条/页', exact: true }).click();
  await expect(page).toHaveURL(/status=failed&agentPageSize=50&taskPageSize=100/);
  await expect(page.getByRole('combobox', { name: '后台任务分页每页数量' })).toContainText(
    '100 条/页',
  );
  await expect(page.getByRole('combobox', { name: 'Agent 运行分页每页数量' })).toContainText(
    '50 条/页',
  );
  await page.goto('/jobs?pageSize=invalid');
  await expect(page.getByRole('combobox', { name: '职位分页每页数量' })).toContainText('20 条/页');
});
