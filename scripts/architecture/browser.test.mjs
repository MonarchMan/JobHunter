import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';

const requireWeb = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const { chromium } = requireWeb('@playwright/test');
const { default: AxeBuilder } = requireWeb('@axe-core/playwright');
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
    : {}),
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const output = fileURLToPath(new URL('../../var/architecture-review/', import.meta.url));
await mkdir(output, { recursive: true });
try {
  // 1. 离线打开完整产物，检查页面没有隐藏的网络依赖。
  await page.context().setOffline(true);
  await page.goto(new URL('../../docs/arch/image/index.html', import.meta.url).href);
  await page.locator('.node').first().waitFor();
  assert.equal(await page.locator('.node').count(), 11);
  await page.screenshot({ path: `${output}/desktop.png`, fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: '任务与业务编排', exact: false }).click();
  assert.equal(await page.locator('#detail-title').textContent(), '任务与业务编排');
  assert.ok((await page.locator('.edge.highlight').count()) >= 3);
  // 2. 搜索入口已移除，取消选择与键盘关系导航仍完整可用。
  assert.equal(await page.getByRole('searchbox').count(), 0);
  assert.equal(await page.getByRole('button', { name: '系统架构图', exact: true }).count(), 1);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.node[aria-pressed="true"]').count(), 0);
  const node = page.locator('.node[data-id="worker"]');
  await node.focus();
  await page.keyboard.press('Enter');
  assert.equal(await node.getAttribute('aria-pressed'), 'true');
  await page.locator('#relations button').first().click();
  assert.equal(await page.locator('#detail-title').textContent(), '任务与业务编排');
  await page.getByRole('button', { name: '取消选择' }).click();
  const initialZoom = await page.locator('#zoom-value').textContent();
  await page.getByRole('button', { name: '放大', exact: true }).click();
  assert.notEqual(await page.locator('#zoom-value').textContent(), initialZoom);
  await page.getByRole('button', { name: '适应画布' }).click();
  // 3. 主题、两张视图和真实下载事件，保证工具条不是装饰。
  await page.getByRole('button', { name: '切换深色' }).click();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  await page.screenshot({ path: `${output}/dark.png`, fullPage: true, animations: 'disabled' });
  const darkAudit = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  assert.deepEqual(
    darkAudit.violations.map((item) => ({ id: item.id, targets: item.nodes.map((n) => n.target) })),
    [],
  );
  await page.getByRole('button', { name: '求职流程', exact: true }).click();
  assert.equal(await page.locator('.node').count(), 10);
  await page.locator('.node[data-id="profile"]').click();
  await page.getByRole('button', { name: '→ 项目经历/工作经历 · 经历信息', exact: true }).click();
  assert.equal(await page.locator('#detail-title').textContent(), '项目经历/工作经历');
  await page.getByRole('button', { name: '→ 面试准备档案 · 建立档案', exact: true }).click();
  assert.match(await page.locator('#detail-text').textContent(), /不是从简历自动生成/);
  await page.getByRole('button', { name: '取消选择' }).click();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 SVG', exact: true }).click();
  const download = await downloadEvent;
  assert.equal(download.suggestedFilename(), 'jobhunter-flow.svg');
  await download.saveAs(`${output}/export.svg`);
  await page.getByRole('button', { name: '切换浅色' }).click();
  await page.screenshot({ path: `${output}/flow.png`, fullPage: true, animations: 'disabled' });
  const lightAudit = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  assert.deepEqual(
    lightAudit.violations.map((item) => ({
      id: item.id,
      targets: item.nodes.map((n) => n.target),
    })),
    [],
  );
  // 4. 手机保留完整操作，画布内部滚动，不造成整个页面横向溢出。
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: '适应画布' }).click();
  await page.locator('.node').first().focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#detail-title').textContent(), '导入简历');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  assert.equal(
    await page
      .locator('.node')
      .first()
      .evaluate((el) => getComputedStyle(el).transitionDuration),
    '0s',
  );
  await page.screenshot({ path: `${output}/mobile.png`, fullPage: true, animations: 'disabled' });
  assert.deepEqual(errors, []);
  console.log(
    '架构浏览器验证通过：离线、无搜索控件、关系、键盘、缩放、主题、SVG 下载、窄屏、减少动态效果、双主题 axe。',
  );
} finally {
  await browser.close();
}
