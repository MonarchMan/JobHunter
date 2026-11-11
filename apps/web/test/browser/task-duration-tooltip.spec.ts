import { expect, test } from '@playwright/test';

for (const width of [1440, 1024]) {
  test(`task duration tooltip escapes clipping and stays centered at ${String(width)}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/tasks?range=all&type=maintenance.sqlite');
    const cell = page
      .getByRole('table', { name: '后台任务列表' })
      .locator('tbody tr')
      .first()
      .locator('td')
      .nth(4);
    const trigger = cell.getByRole('group');
    const tooltip = trigger.getByRole('tooltip');
    await expect(cell).not.toHaveAttribute('title');
    await expect(cell.locator('[title]')).toHaveCount(0);
    await expect(tooltip).toBeHidden();
    await trigger.evaluate((element) => {
      let enteredAt = 0;
      element.addEventListener(
        'pointerenter',
        () => {
          enteredAt = performance.now();
        },
        { once: true },
      );
      element.addEventListener(
        'beforetoggle',
        () => {
          element.dataset.hoverDelay = String(performance.now() - enteredAt);
        },
        { capture: true, once: true },
      );
    });
    await trigger.hover();
    await page.waitForTimeout(500);
    await expect(tooltip).toBeHidden();
    await expect(tooltip).toBeVisible();
    const delay = Number(await trigger.getAttribute('data-hover-delay'));
    expect(delay).toBeGreaterThanOrEqual(950);
    expect(delay).toBeLessThan(1500);
    await expect(tooltip).toContainText(' - ');
    await expect(tooltip).toContainText('2026');
    expect(await tooltip.evaluate((element) => element.matches(':popover-open'))).toBe(true);
    const anchorBox = await trigger.boundingBox();
    const tooltipBox = await tooltip.boundingBox();
    if (!anchorBox || !tooltipBox) throw new Error('耗时提示未显示');
    expect(
      Math.abs(anchorBox.x + anchorBox.width / 2 - tooltipBox.x - tooltipBox.width / 2),
    ).toBeLessThan(1);
    expect(tooltipBox.x).toBeGreaterThanOrEqual(12);
    expect(tooltipBox.x + tooltipBox.width).toBeLessThanOrEqual(width - 12);
    await expect(tooltip).toHaveCSS('background-color', 'rgb(17, 24, 39)');
    await expect(tooltip).toHaveCSS('color', 'rgb(255, 255, 255)');
    // 跨越触发值与面板间隙后停留，不能被旧的关闭计时器收起。
    await page.mouse.move(anchorBox.x + anchorBox.width / 2, tooltipBox.y - 3);
    await page.waitForTimeout(100);
    await tooltip.hover();
    await page.waitForTimeout(350);
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toHaveCSS('user-select', 'text');
    await tooltip.click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(tooltip).toBeVisible();
    // 点击面板可能令外层可聚焦文本获得焦点，先释放焦点再验证纯鼠标离开。
    await trigger.blur();
    await page.getByRole('heading', { name: '后台任务', exact: true }).hover();
    await expect(tooltip).toBeHidden();
    await page.keyboard.press('Shift');
    await trigger.focus();
    await expect(tooltip).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(tooltip).toBeHidden();
  });
}
