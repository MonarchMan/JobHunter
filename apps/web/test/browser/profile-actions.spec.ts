import { expect, test, type Locator } from '@playwright/test';

test('我的页在标签下方直接显示简历导入，不重复显示画像切换区', async ({ page }) => {
  await page.goto('/my');
  await expect(page.getByRole('navigation', { name: '我的页面分区' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '导入简历' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '个人资料', exact: true })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: '选择画像' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '查看', exact: true })).toHaveCount(0);
});

/** 非空的控件边界，用于比较响应式布局的实际尺寸。 */
type ControlBounds = NonNullable<Awaited<ReturnType<Locator['boundingBox']>>>;

/** 读取实际控件边界，布局缺失时给出明确的测试失败。 */
async function controlBounds(control: Locator): Promise<ControlBounds> {
  const bounds = await control.boundingBox();
  if (!bounds) throw new Error('操作栏控件不可见，无法验证布局。');
  return bounds;
}

test('我的页底部操作栏在窄屏等宽等高且不溢出，宽屏保留横向排列', async ({ page }) => {
  // 1、在同一页面依次调整视口，覆盖手机、断点两侧及桌面布局。
  await page.goto('/my');
  const actions = page.locator('[data-resume-editor-actions]');
  const controls = [
    actions.getByRole('combobox', { name: '简历模板' }),
    actions.getByRole('button', { name: '导出', exact: true }),
    actions.getByRole('button', { name: '预览', exact: true }),
    actions.getByRole('button', { name: '保存简历', exact: true }),
  ] as const;
  for (const width of [320, 390, 500, 700, 701, 768, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await actions.scrollIntoViewIfNeeded();
    const boxes = await Promise.all([
      controlBounds(controls[0]),
      controlBounds(controls[1]),
      controlBounds(controls[2]),
      controlBounds(controls[3]),
    ]);
    const [templateBox, exportBox, previewBox, saveBox] = boxes;
    // 2、所有尺寸下保持触控高度与单行文字，不允许页面或控件横向溢出。
    for (const box of boxes) {
      expect(box.height).toBe(44);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
    }
    for (const control of controls) {
      expect(await control.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    // 3、手机四个控件按相同列宽对齐；桌面全部处于同一行。
    if (width <= 700) {
      expect(
        Math.max(...boxes.map((box) => box.width)) - Math.min(...boxes.map((box) => box.width)),
      ).toBeLessThanOrEqual(1);
      expect(templateBox.y).toBe(exportBox.y);
      expect(previewBox.y).toBe(saveBox.y);
      expect(previewBox.y).toBeGreaterThan(templateBox.y + templateBox.height);
      expect(templateBox.x).toBe(previewBox.x);
      expect(exportBox.x).toBe(saveBox.x);
    } else if (width === 1280) {
      expect(new Set(boxes.map((box) => box.y)).size).toBe(1);
    }
    if (width === 390) {
      await actions.screenshot({ path: test.info().outputPath('profile-actions-mobile.png') });
    }
  }
});

test('窄屏模板选择、打开失败提示和预览仍然可用', async ({ page }) => {
  // 1、模板接口使用隔离失败响应，验证错误提示不会挤压任何操作。
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/my');
  const actions = page.locator('[data-resume-editor-actions]');
  const template = actions.getByRole('combobox', { name: '简历模板' });
  await template.click();
  await page.getByRole('option', { name: '简洁单页', exact: true }).click();
  await expect(template).toHaveText('简洁单页');
  await page.route('**/api/resume-drafts', (route) =>
    route.fulfill({
      status: 503,
      json: { error: { message: '暂时无法打开简历制作页，请稍后重试。' } },
    }),
  );
  await actions.getByRole('button', { name: '导出', exact: true }).click();
  await expect(actions.getByRole('alert')).toHaveText('暂时无法打开简历制作页，请稍后重试。');
  const errorBox = await controlBounds(actions.getByRole('alert'));
  const preview = actions.getByRole('button', { name: '预览', exact: true });
  const previewBox = await controlBounds(preview);
  expect(previewBox.y).toBeGreaterThanOrEqual(errorBox.y + errorBox.height);
  expect(previewBox.height).toBe(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  // 2、预览打开与关闭恢复焦点，保留原有交互行为。
  await preview.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  // 2.a、窄屏关闭按钮保持红色正方形，避免全局文字按钮样式将其拉宽。
  const closeButton = page.getByRole('button', { name: '关闭预览', exact: true });
  const closeBounds = await controlBounds(closeButton);
  expect(closeBounds.width).toBe(36);
  expect(closeBounds.height).toBe(36);
  await expect(closeButton.locator('svg')).toBeVisible();
  const danger = await closeButton.evaluate((element) => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--danger)';
    element.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });
  await expect(closeButton).toHaveCSS('color', danger);
  await closeButton.hover();
  await expect(closeButton).toHaveCSS('color', danger);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(preview).toBeFocused();
});
