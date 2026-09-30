import { expect, test } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

for (const width of [1280, 390]) {
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
    const records = width === 1280 ? page.locator('tbody tr') : page.getByRole('article');
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
