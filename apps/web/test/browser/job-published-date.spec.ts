import { expect, test } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

test('job sort headers toggle direction and reset pagination', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/jobs?source=platform&provider=boss&pageSize=10&page=2');
  const table = page.getByRole('table', { name: '可投递职位列表' });
  const updateHeading = table.getByRole('columnheader', { name: '更新时间', exact: true });
  await expect(updateHeading).toHaveAttribute('aria-sort', 'descending');
  await table.getByRole('link', { name: '按更新时间升序排列' }).click();
  await expect(page).toHaveURL(
    /source=platform&provider=boss&pageSize=10&sort=updated_desc&direction=asc$/,
  );
  await expect(updateHeading).toHaveAttribute('aria-sort', 'ascending');
  await expect(table.locator('tbody tr').first()).toContainText('BOSS 平台工程师 1');
  await table.getByRole('link', { name: '按匹配分数降序排列' }).click();
  await expect(table.getByRole('columnheader', { name: '匹配分数', exact: true })).toHaveAttribute(
    'aria-sort',
    'descending',
  );
  await table.getByRole('link', { name: '按匹配分数升序排列' }).click();
  await expect(page).toHaveURL(/sort=score_desc&direction=asc$/);
  await table.getByRole('link', { name: '按发布时间降序排列' }).click();
  await expect(page).toHaveURL(/sort=published_desc&direction=desc$/);
  await page.goto('/jobs?sort=published_desc');
  await table.getByRole('link', { name: '按发布时间升序排列' }).click();
  await expect(page).toHaveURL(/sort=published_desc&direction=asc$/);
  await expect(table.locator('tbody tr').first()).toContainText('大模型应用实习生');
  await page.setViewportSize({ width: 390, height: 900 });
  const filters = page.getByRole('form', { name: '职位筛选' });
  await filters.getByRole('combobox', { name: '排序方向' }).click();
  await page.getByRole('option', { name: '降序', exact: true }).click();
  await filters.getByRole('button', { name: '搜索' }).click();
  await expect(page).toHaveURL(/direction=desc/);
});

for (const width of [1280, 390]) {
  test(`job update sorting shows the record date at ${String(width)}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const records = page.locator('tbody tr');
    for (const [query, title, timestamp] of [
      ['sort=updated_desc', '大模型应用实习生', '1970-01-01T00:00:00.003Z'],
      ['source=platform&provider=boss', 'BOSS 平台工程师 11', '1970-01-01T00:00:00.011Z'],
    ] as const) {
      await page.goto(`/jobs?${query}`);
      const record = records.filter({ has: page.getByRole('link', { name: title, exact: true }) });
      if (width === 1280) {
        await expect(page.getByRole('columnheader', { name: '更新时间' })).toBeVisible();
        await expect(page.getByRole('columnheader', { name: '发布时间' })).toHaveCount(0);
      } else {
        await expect(record.getByText('更新时间：', { exact: true })).toBeVisible();
      }
      await expect(record.locator('time')).toHaveAttribute('datetime', timestamp);
      await expect(records.first()).toContainText(title);
    }
    await page.goto('/jobs?source=platform&provider=boss&sort=published_desc');
    await expect(records.first().getByText('未提供', { exact: true })).toBeVisible();
  });

  test(`job publication dates remain source-owned at ${String(width)}px`, async ({ page }) => {
    // 1、日期列与发布时间排序读取同一来源字段，不展示本地更新时间。
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/jobs?sort=published_desc');
    if (width === 1280) {
      await expect(page.getByRole('columnheader', { name: '发布时间', exact: true })).toBeVisible();
      await expect(page.getByRole('columnheader', { name: '更新时间', exact: true })).toHaveCount(
        0,
      );
    }
    const records = page.locator('tbody tr');
    const known = records.filter({
      has: page.getByRole('link', { name: '大模型应用实习生', exact: true }),
    });
    await expect(records.first()).toContainText('大模型应用实习生');
    await expect(known.locator('time')).toHaveAttribute('datetime', '2026-08-01T16:30:00.000Z');
    await expect(known.locator('time')).toHaveText('2026/8/2');
    // 2、未知来源时间明确显示未提供；同步时间不能作为兜底值。
    const unknown = records.filter({
      has: page.getByRole('link', { name: 'AI 产品实习生', exact: true }),
    });
    await expect(unknown.getByText('未提供', { exact: true })).toBeVisible();
    await expect(unknown.locator('time')).toHaveCount(0);
    await expect(page.getByText(/更新于/)).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: `../../var/qa/job-published-date-${String(width)}.png`,
      fullPage: true,
    });
    // 3、替换日期不影响键盘访问站内详情及列表恢复。
    await known.getByRole('link', { name: '查看职位详情：大模型应用实习生' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: '匹配与建议' })).toBeVisible();
    await page.getByRole('link', { name: '← 返回职位列表' }).click();
    await expect(page).toHaveURL(/\/jobs\?sort=published_desc$/);
  });
}
