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
    const dateInput = page.getByRole('textbox', { name: '最早可到岗日期', exact: true });
    await dateInput.click();
    const calendar = page.getByRole('dialog', { name: '最早可到岗日期日历' });
    const inputBox = await dateInput.boundingBox();
    const calendarBox = await calendar.boundingBox();
    expect(Math.abs((inputBox?.width ?? 0) - (calendarBox?.width ?? 999))).toBeLessThanOrEqual(1);
    expect(Math.abs((inputBox?.x ?? 0) - (calendarBox?.x ?? 999))).toBeLessThanOrEqual(1);
    const firstDay = calendar.getByRole('button', { name: /^\d{4}-\d{2}-01$/ });
    const chosenDate = await firstDay.getAttribute('aria-label');
    await firstDay.click();
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
    await expect(page.getByRole('textbox', { name: '最早可到岗日期', exact: true })).toHaveValue(
      chosenDate ?? '',
    );
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
    await dateInput.click();
    await calendar.getByRole('button', { name: '清除', exact: true }).click();
    await page.getByLabel('可持续实习月数').fill('');
    const cleared = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/profile') && response.request().method() === 'PATCH',
    );
    await save.click();
    expect((await cleared).ok()).toBe(true);
    await expect(page.getByText('结构化简历已保存为新版本。')).toBeVisible();
    await expect(page.getByLabel('毕业届别（年份）')).toHaveValue('');
    await expect(page.getByRole('textbox', { name: '最早可到岗日期', exact: true })).toHaveValue(
      '',
    );
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page
      .locator('#resume-intention')
      .screenshot({ path: `../../var/recruitment-facts-${String(width)}.png` });
  });
}

test('recruitment detail separates objective conditions from model assessment', async ({
  page,
}) => {
  await page.goto('/jobs/018f0000-0000-7000-8000-000000000402');
  await expect(page.getByText(/招聘类别：/)).toHaveCount(0);
  await expect(page.getByText(/证据完整度/)).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('font-size', '16px');
  await expect(page.getByRole('heading', { name: '职位描述', exact: true })).toHaveCSS(
    'font-size',
    '14px',
  );
  await expect(page.getByText('客观条件', { exact: true })).toHaveCount(0);
  await expect(page.getByText('地点', { exact: true })).toBeVisible();
  await expect(page.getByText('项目 / 实践', { exact: true })).toHaveCount(0);
  await expect(page.getByText('暂无模型评分', { exact: true })).toBeVisible();
  await expect(page.locator('summary').filter({ hasText: /待确认|查看匹配依据/ })).toHaveCount(0);
  const rules = page.getByRole('region', { name: '规则评分', exact: true });
  const model = page.getByRole('region', { name: '模型评分', exact: true });
  await expect(rules).toBeVisible();
  await expect(model).toBeVisible();
  const ruleHeading = rules.getByRole('heading', { name: '规则评分', exact: true });
  await expect(ruleHeading.locator('..')).toHaveCSS('display', 'flex');
  expect((await rules.locator('strong').first().boundingBox())?.x).toBeGreaterThan(
    (await ruleHeading.boundingBox())?.x ?? 0,
  );
  const ruleBox = await rules.boundingBox();
  const modelBox = await model.boundingBox();
  expect(Math.abs((ruleBox?.y ?? 0) - (modelBox?.y ?? 999))).toBeLessThanOrEqual(1);
  await expect(page.getByRole('heading', { name: '简历重点', exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: '../../var/recruitment-detail.png', fullPage: true });
});
