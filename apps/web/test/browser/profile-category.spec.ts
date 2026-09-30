import { expect, test } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

test('保存失败保留类别、细分与意向草稿', async ({ page }) => {
  await page.goto('/profile');
  const field = page.getByRole('combobox', { name: '职位类别', exact: true });
  await field.click();
  await page.getByRole('option', { name: '设计', exact: true }).click();
  await page.getByRole('option', { name: '交互设计', exact: true }).click();
  const intended = page.getByRole('textbox', { name: '意向岗位', exact: true });
  await intended.fill('交互设计师');
  await page.route('**/api/profile', async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue();
    await route.fulfill({ status: 503, json: { error: { message: '暂时无法保存，请重试。' } } });
  });
  await page.getByRole('button', { name: '保存简历', exact: true }).click();
  await expect(page.getByText('暂时无法保存，请重试。', { exact: true })).toBeVisible();
  await expect(field).toHaveText('设计 / 交互设计');
  await expect(intended).toHaveValue('交互设计师');
  await expect(page.getByRole('button', { name: '保存简历', exact: true })).toBeEnabled();
});

test('类别逐级选择仅在叶子确认，返回与取消保持原值', async ({ page }) => {
  await page.goto('/profile');
  const field = page.getByRole('combobox', { name: '职位类别', exact: true });
  await expect(page.getByRole('combobox', { name: '细分岗位（可选）' })).toHaveCount(0);
  await field.click();
  await page.getByRole('option', { name: '研发', exact: true }).click();
  await expect(page.getByRole('listbox', { name: '职位类别：研发' })).toBeVisible();
  await expect(page.getByRole('option')).toHaveText([
    '返回职位类别',
    '不限',
    '后端',
    '前端',
    '算法',
    '客户端',
  ]);
  await expect(page.getByText('不限 / 待确认', { exact: true })).toHaveCount(0);
  await page.getByRole('option', { name: '后端', exact: true }).click();
  await expect(field).toHaveText('研发 / 后端');
  await expect(field).toBeFocused();

  // 1、进入另一个类别不提交中间状态，Escape 及外部点击均保留原选择。
  await field.click();
  await page.getByRole('option', { name: '产品', exact: true }).click();
  await expect(page.getByRole('option')).toHaveText(['返回职位类别', '不限', '产品经理']);
  await expect(page.locator('input[name="jobCategory"]')).toHaveValue('研发/后端');
  await page.keyboard.press('Escape');
  await expect(field).toHaveText('研发 / 后端');
  await expect(field).toBeFocused();
  await field.click();
  await page.getByRole('option', { name: '设计', exact: true }).click();
  await expect(page.getByRole('listbox', { name: '职位类别：设计' })).toBeVisible();
  await page.mouse.click(10, 10);
  await expect(field).toHaveText('研发 / 后端');
  await expect(field).toBeFocused();

  // 2、返回大类后可以继续切换，无细分的大类仍须显式确认“不限”。
  await field.click();
  await page.getByRole('option', { name: '设计', exact: true }).click();
  await page.getByRole('option', { name: '返回职位类别', exact: true }).click();
  await page.getByRole('option', { name: '运营', exact: true }).click();
  await expect(page.getByRole('option')).toHaveText(['返回职位类别', '不限']);
  await page.getByRole('option', { name: '不限', exact: true }).click();
  await expect(field).toHaveText('运营 / 不限');
  await field.click();
  await page.getByRole('option', { name: '请选择职位大类', exact: true }).click();
  await expect(field).toHaveText('请选择职位大类');
  await expect(page.locator('input[name="jobCategory"]')).toHaveValue('');
});

test('两级选项在窄屏可用且沿用无障碍与弹层几何', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/profile');
  const field = page.getByRole('combobox', { name: '职位类别', exact: true });
  await field.scrollIntoViewIfNeeded();
  const triggerBox = await field.boundingBox();
  await field.click();
  await page.getByRole('option', { name: '研发', exact: true }).click();
  const popup = page.getByRole('listbox', { name: '职位类别：研发' });
  await expect(popup).toBeVisible();
  const popupBox = await popup.boundingBox();
  expect(Math.abs((popupBox?.width ?? 0) - (triggerBox?.width ?? 0))).toBeLessThanOrEqual(1);
  expect(popupBox?.x).toBeGreaterThanOrEqual(0);
  expect((popupBox?.x ?? 0) + (popupBox?.width ?? 0)).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const axe = await new AxeBuilder({ page })
    .include('[data-authored-select-content]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(axe.violations).toEqual([]);
  await page.screenshot({
    path: test.info().outputPath('category-mobile.png'),
    animations: 'disabled',
  });
  await page.getByRole('option', { name: '算法', exact: true }).press('Enter');
  await expect(field).toHaveText('研发 / 算法');
  await expect(field).toBeFocused();
  const closedAxe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(closedAxe.violations).toEqual([]);
});

test('类别与细分一起保存回读，不限不影响资格或意向岗位', async ({ page }) => {
  await page.goto('/profile');
  const field = page.getByRole('combobox', { name: '职位类别', exact: true });
  const intended = page.getByRole('textbox', { name: '意向岗位', exact: true });
  await intended.fill('大模型算法工程师');
  await page.getByLabel('毕业届别（年份）', { exact: true }).fill('2027');
  // 1、依次验证具体细分及不限；使用隔离 API 的真实保存和版本回读。
  for (const [family, subfamily] of [
    ['研发', '算法'],
    ['产品', '不限'],
  ] as const) {
    await field.click();
    await page.getByRole('option', { name: family, exact: true }).click();
    await page.getByRole('option', { name: subfamily, exact: true }).click();
    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/profile') && response.request().method() === 'PATCH',
    );
    await page.getByRole('button', { name: '保存简历', exact: true }).click();
    const response = await saved;
    expect(response.ok()).toBe(true);
    await expect(page.getByRole('status').filter({ hasText: '已保存' })).toBeVisible();
    const command = response.request().postDataJSON() as { profileId: string };
    const persisted = await page.request.get(`/api/profile?profile=${command.profileId}`);
    const payload = (await persisted.json()) as {
      data: {
        detail: {
          current: {
            effective: {
              targetRoles: string[];
              intendedRoles: string[];
              matchingConstraints: { targetSubfamily: string | null; graduationYear: number };
            };
          };
        };
      };
    };
    expect(payload.data.detail.current.effective).toMatchObject({
      targetRoles: [family],
      intendedRoles: ['大模型算法工程师'],
      matchingConstraints: {
        targetSubfamily: subfamily === '不限' ? null : subfamily,
        graduationYear: 2027,
      },
    });
    await expect(field).toHaveText(`${family} / ${subfamily}`);
    await expect(intended).toHaveValue('大模型算法工程师');
  }
});
