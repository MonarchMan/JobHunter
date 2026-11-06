import { expect, test } from '@playwright/test';

test('历史会话持续可读，新会话支持两种类别和回答覆盖编辑', async ({ page }) => {
  await page.goto('/interview');
  await page.getByRole('combobox', { name: '选择会话' }).click();
  await page.getByRole('option', { name: '项目面试', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'AI 对话与模拟面试' })).toBeVisible();
  await expect(
    page.getByText('为什么把模型调用放在事务提交之后，失败时如何保持任务可重试？'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: '暂停' })).toHaveCount(0);
  await page.getByLabel('会话名称').fill('日常对话测试');
  await page.getByRole('combobox', { name: '会话类别' }).click();
  await page.getByRole('option', { name: '日常对话', exact: true }).click();
  await page.getByRole('button', { name: '新建会话' }).click();
  await expect(page.getByRole('heading', { name: '日常对话测试' })).toBeVisible();
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('原始回答');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.getByText('原始回答', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '修改回答', exact: true }).click();
  await page.getByRole('textbox', { name: '修改回答' }).fill('更新后的回答');
  await page.getByRole('button', { name: '保存回答' }).click();
  await expect(page.getByText('更新后的回答', { exact: true })).toBeVisible();
  await expect(page.getByText('原始回答', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeDisabled();
  await page.reload();
  await expect(page.getByText('更新后的回答', { exact: true })).toBeVisible();
  // 切换到新会话时清除上一会话的编辑状态和未发送草稿。
  await page.getByRole('button', { name: '修改回答', exact: true }).click();
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('旧会话草稿');
  await page.getByLabel('会话名称').fill('另一个会话');
  await page.getByRole('button', { name: '新建会话' }).click();
  await expect(page.getByRole('heading', { name: '另一个会话', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '消息', exact: true })).toHaveValue('');
  await expect(page.getByRole('textbox', { name: '修改回答', exact: true })).toHaveCount(0);
});
