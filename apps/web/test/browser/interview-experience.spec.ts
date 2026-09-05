import { expect, test } from '@playwright/test';

test.describe('个人面经导入', () => {
  test('shows the standard template and accepts an online entry as history', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 950 });
    await page.goto('/interview/experiences');

    await expect(page.getByRole('heading', { name: '历史面经', level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: '历史面经' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    const download = page.getByRole('link', { name: '下载模板' });
    await expect(download).toHaveAttribute('href', '/api/interview/experiences/template');
    await page.getByText('查看模板内容').click();
    await expect(page.locator('pre')).toContainText('模板版本：personal-experience@v1');

    const online = page.getByRole('form', { name: '在线填写' });
    await online.getByLabel('公司', { exact: true }).fill('浏览器测试公司');
    await online.getByLabel('岗位', { exact: true }).fill('平台工程师');
    await online.getByLabel('面试阶段', { exact: true }).fill('技术一面');
    await online.getByLabel('面试日期', { exact: true }).fill('2026-08-30');
    await online.getByLabel('标签', { exact: true }).fill('TypeScript、数据库');
    await online.getByLabel('问题', { exact: true }).fill('如何保证任务重复执行时的数据一致性？');
    await online.getByLabel('当时的回答（可留空）').fill('使用内容哈希和事务内唯一约束。');
    await online.getByLabel('复盘（可选）').fill('补充并发冲突的处理过程。');
    await online.getByRole('button', { name: '生成校对草稿' }).click();

    await expect(page).toHaveURL(/\/interview\/experiences\/[0-9a-f-]+$/);
    await expect(page.getByRole('heading', { name: '校对后再入库' })).toBeVisible();
    await expect(page.getByRole('form', { name: '校对后再入库' })).toBeVisible();
    const answer = page.getByLabel('当时的回答（可留空）');
    await answer.fill('使用内容哈希、短事务和数据库唯一约束。');
    await page.getByRole('button', { name: '保存草稿' }).click();
    await expect(
      page.getByLabel('通知').getByRole('status').filter({ hasText: '草稿已保存' }),
    ).toBeVisible();
    await page.getByRole('button', { name: '接受为历史面经' }).click();

    await expect(page.getByRole('heading', { name: '已进入历史面经' })).toBeVisible();
    await expect(page.getByText('使用内容哈希、短事务和数据库唯一约束。')).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      )
      .toBe(true);
  });
});
