import { expect, test } from '@playwright/test';

test('switches physical sources without stacking panels on desktop and mobile', async ({
  page,
}) => {
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/sources');
    const links = await page
      .getByRole('navigation', { name: '招聘来源分页' })
      .getByRole('link')
      .evaluateAll((elements) =>
        elements.map((element) => element.getAttribute('href') ?? '/sources'),
      );
    const card = page
      .locator('[data-company-source-card]')
      .filter({ has: page.getByRole('heading', { name: '滴滴', exact: true }) });
    for (const href of ['/sources', ...links]) {
      await page.goto(href);
      if (await card.count()) break;
    }
    await expect(card).toBeVisible();
    const selector = card.getByRole('combobox', { name: '滴滴招聘渠道', exact: true });
    await selector.click();
    await page.getByRole('option', { name: '校招', exact: true }).click();
    const panels = card.locator('[data-company-source-panel]');
    const previous = card.getByRole('button', { name: '上一个物理来源' });
    const next = card.getByRole('button', { name: '下一个物理来源' });
    await expect(panels).toHaveCount(1);
    await expect(previous).toHaveCount(0);
    await expect(next).toBeVisible();
    await expect(card.getByText('招聘渠道', { exact: true })).toHaveCount(0);
    await expect(card.getByText('下次执行', { exact: true })).toHaveCount(0);
    await expect(card.locator('details')).toHaveCount(0);
    await panels.getByRole('button', { name: '查看详情' }).click();
    const dialog = page.getByRole('dialog', { name: '官网来源详情' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('下次执行', { exact: true })).toBeVisible();
    await expect(dialog.getByRole('heading', { name: '高级设置' })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: /健康检查/ })).toBeVisible();
    await expect(dialog.locator('footer button').first()).toHaveText('健康检查');
    await expect(dialog.getByRole('button', { name: /^(停用|启用)$/, exact: true })).toBeVisible();
    await expect(dialog.locator('details')).toHaveCount(0);
    await dialog.getByRole('button', { name: '关闭详情' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(panels.getByRole('button', { name: '查看详情' })).toBeFocused();
    const firstUrl = await panels.locator('header a').getAttribute('href');
    await next.click();
    await expect(panels).toHaveCount(1);
    await expect(panels.locator('header a')).not.toHaveAttribute('href', firstUrl ?? '');
    await expect(next).toHaveCount(0);
    await expect(previous).toBeVisible();
    expect(await card.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await previous.click();
    await expect(panels.locator('header a')).toHaveAttribute('href', firstUrl ?? '');
    await next.click();
    await selector.click();
    await page.getByRole('option', { name: '全部', exact: true }).click();
    await expect(previous).toHaveCount(0);
    await expect(next).toHaveCount(0);
    await selector.click();
    await page.getByRole('option', { name: '校招', exact: true }).click();
    await expect(panels.locator('header a')).toHaveAttribute('href', firstUrl ?? '');
    await expect(previous).toHaveCount(0);
    await selector.click();
    await page.getByRole('option', { name: '实习', exact: true }).click();
    await expect(panels).toHaveCount(1);
    await expect(previous).toHaveCount(0);
    await expect(next).toHaveCount(0);
  }
});
