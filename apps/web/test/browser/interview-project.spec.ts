import { expect, test } from '@playwright/test';

test('已完成会话继续后仍显示归档问答', async ({ page }) => {
  // 1. 测试数据预置一份已完成的深档会话和一题归档问答。
  await page.goto('/interview/projects/018f0000-0000-7000-8000-000000000902');
  await expect(page.getByText('1 题已归档')).toBeVisible();

  // 2. 恢复会话后，最近一题仍须可从问答记录中回看。
  await page.getByRole('button', { name: '继续此会话' }).click();
  await expect(page.getByText('1 题已归档')).toBeVisible();
  await expect(
    page.getByRole('heading', {
      name: '为什么把模型调用放在事务提交之后，失败时如何保持任务可重试？',
    }),
  ).toBeVisible();
});
