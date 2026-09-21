import { expect, test } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

/** 混合隔离夹具验证统一列表，所有筛选只读取本地数据库。 */
test('jobs default to official and isolate platform provider, categories and pagination', async ({
  page,
}) => {
  let mutations = 0;
  page.on('request', (request) => {
    if (request.url().includes('/api/platforms/') && request.method() === 'POST') mutations++;
  });
  await page.goto('/jobs');
  const source = page.getByRole('combobox', { name: '来源类型', exact: true });
  await expect(source).toHaveText('官网来源');
  await expect(page.getByRole('link', { name: 'BOSS 平台工程师 1', exact: true })).toHaveCount(0);
  // 1、共享选择器支持键盘与等宽弹层，切换不会残留实习默认筛选。
  await source.focus();
  const triggerBox = await source.boundingBox();
  await page.keyboard.press('Enter');
  const popup = page.getByRole('listbox');
  await expect(popup).toBeVisible();
  const popupBox = await popup.boundingBox();
  expect(Math.abs((triggerBox?.width ?? 0) - (popupBox?.width ?? 0))).toBeLessThanOrEqual(1);
  await page.getByRole('option', { name: '官网来源', exact: true }).focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('option', { name: '招聘平台', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/source=platform/);
  await expect(page.getByText('共 3 个职位', { exact: false })).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'BOSS 平台工程师 1', exact: true }).first(),
  ).toBeVisible();
  await page.getByRole('combobox', { name: '招聘平台', exact: true }).click();
  await page.getByRole('option', { name: 'BOSS 直聘', exact: true }).click();
  await expect(page).toHaveURL(/provider=boss/);
  await expect(page.getByText('共 2 个职位', { exact: false })).toBeVisible();
  await page.goto('/jobs?source=platform&provider=boss&limit=1');
  await page
    .getByRole('navigation', { name: '职位分页' })
    .getByRole('link', { name: '2', exact: true })
    .click();
  await expect(page).toHaveURL(/source=platform.*provider=boss.*page=2/);
  await page
    .getByRole('link', { name: /查看职位详情：BOSS/ })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: '职位描述' })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/source=platform.*provider=boss.*page=2/);
  // 2、窄屏沿用职位卡片；无结果仍保留同一来源的恢复入口。
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/jobs?source=platform&provider=zhilian');
  await expect(page.getByText('共 1 个职位', { exact: false })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: 'test-results/platform-jobs-mobile.png',
    fullPage: true,
    caret: 'initial',
  });
  await page.goto('/jobs?source=platform&category=internship');
  await expect(page.getByRole('heading', { name: '没有符合条件的职位' })).toBeVisible();
  await expect(page.getByRole('link', { name: '清除筛选', exact: true })).toHaveAttribute(
    'href',
    '/jobs?source=platform',
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/jobs?source=platform');
  await page.screenshot({
    path: 'test-results/platform-jobs-desktop.png',
    fullPage: true,
    caret: 'initial',
  });
  expect(mutations).toBe(0);
});

/** 清除普通过滤条件与空状态恢复不得丢失已选择的平台。 */
test('platform empty recovery and filter clearing preserve the selected provider', async ({
  page,
}) => {
  // 1、每个平台都从空结果恢复，验证两个清除入口和管理来源使用相同范围。
  for (const provider of ['boss', 'zhilian', '51job', 'liepin']) {
    await page.goto(`/jobs?source=platform&provider=${provider}&q=not-a-real-job`);
    await expect(page.getByRole('heading', { name: '没有符合条件的职位' })).toBeVisible();
    for (const name of ['清除', '清除筛选']) {
      await expect(page.getByRole('link', { name, exact: true })).toHaveAttribute(
        'href',
        `/jobs?source=platform&provider=${provider}`,
      );
    }
    await page.getByRole('link', { name: '管理招聘来源', exact: true }).click();
    await expect(page).toHaveURL(`/sources?channel=platform&provider=${provider}`);
    await expect(
      page.getByRole('navigation', { name: '招聘平台选择' }).locator('[aria-current="page"]'),
    ).toHaveAttribute('href', `/sources?channel=platform&provider=${provider}`);
  }
});
