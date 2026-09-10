import { expect, test } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

// 固定修订的详情基线在 core 的全画像版本变更场景之前验证，避免将历史结果误当当前结果。

for (const width of [1280, 390]) {
  test(`recruitment facts save, clear and recover at ${String(width)}px`, async ({ page }) => {
    // 1. 使用隔离浏览器夹具的画像，验证键盘下拉和真实保存/重载。
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/profile?profile=018f0000-0000-7000-8000-000000000621');
    const student = page.getByRole('combobox', { name: '学籍 / 应届身份', exact: true });
    await student.focus();
    const triggerBox = await student.boundingBox();
    await student.press('Enter');
    const popup = page.getByRole('listbox');
    await expect(popup).toBeVisible();
    const popupBox = await popup.boundingBox();
    expect(triggerBox).not.toBeNull();
    expect(popupBox).not.toBeNull();
    expect(Math.abs((triggerBox?.width ?? 0) - (popupBox?.width ?? 999))).toBeLessThanOrEqual(1);
    await page.getByRole('option', { name: '在读（非应届）', exact: true }).click();
    const days = page.getByRole('combobox', { name: '每周可实习天数', exact: true });
    await days.click();
    await page.getByRole('option', { name: '3 天', exact: true }).click();
    await page.getByLabel('毕业届别（年份）').fill('2027');
    await page.getByLabel('可持续实习月数').fill('6');
    await page.getByLabel('最早可到岗日期').fill('2026-10-01');
    const save = page.getByRole('button', { name: '保存简历', exact: true });
    await page.getByLabel('毕业届别（年份）').fill('1800');
    await save.click();
    await expect(page.getByLabel('毕业届别（年份）')).toBeFocused();
    await expect(page.getByText('请输入 1900～2200 之间的整数年份。')).toBeVisible();
    await page.getByLabel('毕业届别（年份）').fill('2027');
    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/profile') && response.request().method() === 'PATCH',
    );
    await save.click();
    expect((await saved).ok()).toBe(true);
    await expect(page.getByText('结构化简历已保存为新版本。')).toBeVisible();
    await expect(student).toContainText('在读（非应届）');
    await expect(days).toContainText('3 天');
    await expect(page.getByLabel('毕业届别（年份）')).toHaveValue('2027');
    await expect(page.getByLabel('最早可到岗日期')).toHaveValue('2026-10-01');
    // 2. 服务端失败保留草稿；随后重试，清空日期/数字不会变为零或非法日期。
    await page.route('**/api/profile', async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue();
      await route.fulfill({
        status: 503,
        json: { error: { message: '测试：暂时无法保存资格信息。' } },
      });
    });
    await page.getByLabel('毕业届别（年份）').fill('2028');
    await save.click();
    await expect(page.getByText('测试：暂时无法保存资格信息。')).toBeVisible();
    await expect(page.getByLabel('毕业届别（年份）')).toHaveValue('2028');
    await page.unroute('**/api/profile');
    await page.getByLabel('毕业届别（年份）').fill('');
    await page.getByLabel('最早可到岗日期').fill('');
    await page.getByLabel('可持续实习月数').fill('');
    const cleared = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/profile') && response.request().method() === 'PATCH',
    );
    await save.click();
    expect((await cleared).ok()).toBe(true);
    await expect(page.getByText('结构化简历已保存为新版本。')).toBeVisible();
    await expect(page.getByLabel('毕业届别（年份）')).toHaveValue('');
    await expect(page.getByLabel('最早可到岗日期')).toHaveValue('');
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page
      .locator('#resume-intention')
      .screenshot({ path: `../../var/recruitment-facts-${String(width)}.png` });
  });
}

test('recruitment detail explains provisional score and inapplicable dimensions', async ({
  page,
}) => {
  await page.goto('/jobs/018f0000-0000-7000-8000-000000000402');
  await expect(page.getByText(/招聘类别：实习/)).toBeVisible();
  await expect(page.getByText(/证据完整度.*暂定分/)).toBeVisible();
  await expect(page.getByRole('heading', { name: '项目 / 实践' })).toBeVisible();
  await expect(page.getByText('不适用', { exact: true })).toHaveCount(2);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: '../../var/recruitment-detail.png', fullPage: true });
});
