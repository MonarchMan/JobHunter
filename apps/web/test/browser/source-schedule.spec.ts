import { expect, test } from '@playwright/test';

test('edits a source schedule with weekly controls and restores global settings', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto('/sources?page=2');
  const card = page
    .locator('[data-company-source-card]')
    .filter({ has: page.getByRole('heading', { name: '腾讯', exact: true }) });
  const channel = card.getByRole('combobox', { name: '腾讯招聘渠道', exact: true });
  await channel.click();
  await page.getByRole('option', { name: '校招', exact: true }).click();
  await expect(card.getByRole('button', { name: '设置 腾讯 的同步计划' })).toHaveCount(0);
  await card.getByRole('button', { name: '查看详情' }).click();
  const details = page.getByRole('dialog', { name: '官网来源详情' });
  await details.getByRole('button', { name: '设置 腾讯 的同步计划' }).click();
  const dialog = page.getByRole('dialog', { name: '设置同步计划' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('radio', { name: '每周', exact: true }).check();
  await dialog.getByRole('combobox', { name: '执行星期', exact: true }).click();
  await dialog.getByRole('option', { name: '周三', exact: true }).click();
  await expect(dialog.getByText('时区：北京时间', { exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: '选择执行时间', exact: true }).click();
  const timePanel = page.getByRole('dialog', { name: '选择执行时间', exact: true });
  await timePanel
    .getByRole('group', { name: '小时', exact: true })
    .getByRole('button', { name: '09', exact: true })
    .click();
  await timePanel
    .getByRole('group', { name: '分钟', exact: true })
    .getByRole('button', { name: '45', exact: true })
    .click();
  await expect(dialog.getByRole('textbox', { name: '执行时间', exact: true })).toHaveValue('09:45');
  await dialog.getByRole('button', { name: '选择执行时间', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(timePanel).toHaveCount(0);
  await expect(dialog).toBeVisible();
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' && response.url().includes('/api/sources/'),
  );
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  expect((await saved).ok()).toBe(true);
  await expect(dialog).toHaveCount(0);
  await details.getByRole('button', { name: '关闭详情' }).click();
  await expect(card.getByText('每周三 09:45', { exact: true })).toBeVisible();
  await page.reload();
  await channel.click();
  await page.getByRole('option', { name: '校招', exact: true }).click();
  await expect(card.getByText('每周三 09:45', { exact: true })).toBeVisible();
  await card.getByRole('button', { name: '查看详情' }).click();
  await details.getByRole('button', { name: '设置 腾讯 的同步计划' }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '关闭同步计划' }).click();
  await expect(details).toBeVisible();
  await expect(details.getByRole('button', { name: '设置 腾讯 的同步计划' })).toBeFocused();
  await details.getByRole('button', { name: '设置 腾讯 的同步计划' }).click();
  const reset = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' && response.url().includes('/api/sources/'),
  );
  await dialog.getByRole('button', { name: '恢复全局计划' }).click();
  expect((await reset).ok()).toBe(true);
  await expect(details.getByRole('button', { name: '设置 腾讯 的同步计划' })).toContainText(
    '每天 03:00',
  );
});
