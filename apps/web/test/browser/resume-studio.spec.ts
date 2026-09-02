import { expect, test } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

const profileId = '018f0000-0000-7000-8000-000000000601';

test.describe('多模板简历制作', () => {
  test('restores a template draft, autosaves edits and exports self-contained HTML', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/profile?profile=${profileId}`);

    const entry = page.locator('[data-resume-template-entry]');
    await entry.getByRole('combobox', { name: '简历模板' }).click();
    await page.getByRole('option', { name: '技术蓝图' }).click();
    await Promise.all([
      page.waitForURL(/\/resume-studio\//u, { timeout: 30_000, waitUntil: 'commit' }),
      entry.getByRole('button', { name: '导出', exact: true }).click(),
    ]);
    await expect(page.locator('[data-resume-studio]')).toBeVisible();
    await expect(page.getByText('技术蓝图', { exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: '基本信息' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    const name = page.getByLabel('姓名');
    await name.fill('浏览器测试候选人');
    await page.getByRole('tab', { name: '工作经历' }).click();
    await expect(page.getByRole('tab', { name: '工作经历' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByRole('status')).toContainText('已保存');
    await expect(page.locator('iframe').contentFrame().getByText('浏览器测试候选人')).toBeVisible();
    expect((await new AxeBuilder({ page }).exclude('iframe').analyze()).violations).toEqual([]);

    const exported = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出 HTML' }).click();
    const file = await exported;
    expect(file.suggestedFilename()).toMatch(/技术蓝图-\d{8}\.html$/u);
    await expect(page.getByRole('status')).toContainText('HTML 已导出');

    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      )
      .toBe(true);
    await expect(page.getByRole('tablist', { name: '简历章节' })).toBeVisible();
  });
});
