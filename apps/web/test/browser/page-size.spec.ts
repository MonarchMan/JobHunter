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

test('pagination keeps totals left, size right and page numbers centered', async ({ page }) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/sources');
    const pagination = page.getByRole('navigation', { name: '招聘来源分页' });
    const summary = pagination.getByText(/^共 \d+ 条$/);
    const size = pagination.getByRole('combobox');
    await expect(summary).toBeVisible();
    await expect(pagination).not.toContainText(/第.*页/);
    const box = await pagination.boundingBox();
    const left = await summary.boundingBox();
    const right = await size.boundingBox();
    if (!box || !left || !right) throw new Error('分页底栏未显示');
    expect(Math.abs(left.x - box.x)).toBeLessThan(8);
    expect(Math.abs(right.x + right.width - box.x - box.width)).toBeLessThan(8);
    expect(Math.abs(left.y + left.height / 2 - right.y - right.height / 2)).toBeLessThan(2);
    const pages = await pagination
      .getByRole('link', { name: '1', exact: true })
      .locator('..')
      .boundingBox();
    if (!pages) throw new Error('页码未显示');
    expect(Math.abs(pages.x + pages.width / 2 - box.x - box.width / 2)).toBeLessThan(2);
  }
});

for (const field of [
  { path: '/tasks', label: '类型' },
  { path: '/jobs', label: '职位类别' },
]) {
  test(`${field.path} type field fits all labels and retains compact all text`, async ({
    page,
  }) => {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(field.path);
      if (field.path === '/jobs')
        await page.locator('summary').filter({ hasText: '筛选职位' }).click();
      const type = page.getByRole('combobox', { name: field.label, exact: true });
      await expect(type).toContainText('全部');
      const trigger = await type.boundingBox();
      await type.click();
      const popup = page.getByRole('listbox', { name: field.label, exact: true });
      for (const option of await popup.getByRole('option').all()) {
        const text = option.locator('span').first();
        expect(
          await text.evaluate((element) => {
            const range = document.createRange();
            range.selectNodeContents(element);
            const option = element.closest('[role="option"]');
            return (
              option !== null &&
              range.getBoundingClientRect().right <= option.getBoundingClientRect().right - 20
            );
          }),
        ).toBe(true);
      }
      const content = await popup.boundingBox();
      if (!trigger || !content) throw new Error('类型选择框未显示');
      expect(Math.abs(trigger.width - content.width)).toBeLessThan(2);
      expect(Math.abs(trigger.x - content.x)).toBeLessThan(2);
      await page.keyboard.press('Escape');
      expect(
        await page.locator('body').evaluate((element) => element.scrollWidth <= innerWidth),
      ).toBe(true);
    }
  });
}

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
