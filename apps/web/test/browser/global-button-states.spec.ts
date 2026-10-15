import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

/** 使用真实全局及日历样式，隔离验证空状态与操作变体的级联和禁用边界。 */
test('scopes global interaction feedback to enabled action variants', async ({ page }) => {
  // 1、按应用顺序加载真实 CSS，并保留日历组件样式检验跨层级冲突。
  const css = [
    '../../app/styles/tokens.css',
    '../../app/styles/foundations.css',
    '../../app/styles/product-shell.css',
    '../../app/_dashboard/dashboard-calendar.module.css',
  ]
    .map((path) => readFileSync(new URL(path, import.meta.url), 'utf8'))
    .join('\n');
  await page.setContent(`<style>${css}</style>
    <button class="emptyState">近期暂无日程</button>
    <button class="button-primary">保存</button>
    <button class="button-secondary">取消</button>
    <button class="button-primary" disabled>保存中</button>`);

  // 2、空状态保持森林绿浅底，且悬停与按下均不触发全局位移动效。
  const empty = page.getByRole('button', { name: '近期暂无日程' });
  await empty.hover();
  await expect(empty).toHaveCSS('background-color', 'rgb(231, 240, 234)');
  await expect(empty).toHaveCSS('transform', 'none');
  await expect(empty).toHaveCSS('box-shadow', 'none');
  await page.mouse.down();
  await expect(empty).toHaveCSS('transform', 'none');
  await page.mouse.up();

  // 3、主次操作保留各自反馈，禁用操作保持原色与静止状态。
  const primary = page.getByRole('button', { name: '保存', exact: true });
  await primary.hover();
  await expect(primary).toHaveCSS('background-color', 'rgb(0, 0, 0)');
  const secondary = page.getByRole('button', { name: '取消' });
  await secondary.hover();
  await expect(secondary).toHaveCSS('background-color', 'rgb(249, 250, 251)');
  const disabled = page.getByRole('button', { name: '保存中' });
  await disabled.hover();
  await expect(disabled).toHaveCSS('background-color', 'rgb(17, 24, 39)');
  await expect(disabled).toHaveCSS('transform', 'none');
  await expect(disabled).toHaveCSS('box-shadow', 'none');
});
