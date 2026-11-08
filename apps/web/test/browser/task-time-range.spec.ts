import { expect, test } from '@playwright/test';
import { webDiagnosticsSchema } from '@jobhunter/recruitment/contracts/web';

test('time range defaults to today, filters both lists and survives page size changes', async ({
  page,
}) => {
  await page.goto('/tasks');
  const range = page.getByRole('combobox', { name: '时间', exact: true });
  await expect(range).toContainText('当天');
  await expect(page.getByRole('button', { name: '数据库空间整理', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '招聘邮件分析', exact: true })).toHaveCount(0);
  for (const [value, label] of [
    ['7d', '近7天'],
    ['30d', '近30天'],
    ['all', '全部'],
  ] as const) {
    await range.click();
    await page.getByRole('option', { name: label, exact: true }).click();
    await page.getByRole('button', { name: '搜索', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`range=${value}`));
    await expect(range).toContainText(label);
  }
  await expect(page.getByRole('button', { name: '数据库空间整理', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '招聘邮件分析', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: '后台任务分页每页数量' }).click();
  await page.getByRole('option', { name: '50 条/页', exact: true }).click();
  await expect(page).toHaveURL(/range=all/);
  await expect(range).toContainText('全部');
  for (const [query, historical] of [
    ['', false],
    ['?range=all', true],
    ['?range=invalid', false],
  ] as const) {
    const response = await page.request.get(`/api/tasks${query}`);
    const body = (await response.json()) as { data: unknown };
    const result = webDiagnosticsSchema.parse(body.data);
    expect(result.tasks.some((task) => task.taskType === 'maintenance.sqlite')).toBe(historical);
    expect(result.agentRuns.some((run) => run.agentKey === 'recruitment-mail.classify')).toBe(
      historical,
    );
  }
  await page.getByRole('link', { name: '清除', exact: true }).click();
  await expect(range).toContainText('当天');
});
