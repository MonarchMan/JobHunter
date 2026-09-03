import { expect, test } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

const profileId = '018f0000-0000-7000-8000-000000000601';

test.describe('多模板简历制作', () => {
  test('restores a template draft, autosaves edits and exports self-contained HTML', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/profile?profile=${profileId}`);

    const entry = page.locator('[data-resume-template-entry]');
    await entry.getByRole('combobox', { name: '简历模板' }).click();
    await page.getByRole('option', { name: '简洁单页' }).click();
    await Promise.all([
      page.waitForURL(/\/resume-studio\//u, { timeout: 30_000, waitUntil: 'commit' }),
      entry.getByRole('button', { name: '导出', exact: true }).click(),
    ]);
    await expect(page.locator('[data-resume-studio]')).toBeVisible();
    await expect(page.getByText('简洁单页', { exact: true })).toBeVisible();
    await expect(page.getByRole('navigation', { name: '简历章节' })).toBeVisible();
    const controlsBox = await page.locator('[data-format-controls]').boundingBox();
    const canvasBox = await page
      .getByRole('region', { name: '可直接编辑的简历画布' })
      .boundingBox();
    expect(controlsBox).not.toBeNull();
    expect(canvasBox).not.toBeNull();
    expect(
      Math.abs(
        (controlsBox?.x ?? 0) +
          (controlsBox?.width ?? 0) / 2 -
          ((canvasBox?.x ?? 0) + (canvasBox?.width ?? 0) / 2),
      ),
    ).toBeLessThan(2);

    const canvas = page.locator('iframe').contentFrame();
    const name = canvas.locator('[data-field="basicInfo.name"]');
    await expect(name).toHaveAttribute('contenteditable', 'true');
    await name.fill('浏览器测试候选人');
    await page.getByRole('button', { name: '增大字号' }).click();
    await expect(page.getByRole('status')).toContainText('已保存');
    await expect(canvas.locator('[data-field="basicInfo.name"]')).toHaveText('浏览器测试候选人');
    await expect(canvas.locator('[data-section-id="basic"]')).toHaveAttribute(
      'style',
      /--section-font-size:13px/u,
    );
    await expect(canvas.getByText('研发 / 大模型应用实习生 / Agent 实习生')).toBeVisible();
    const nameBox = await canvas.locator('h1').boundingBox();
    const directionBox = await canvas.locator('.role-line').boundingBox();
    expect(nameBox).not.toBeNull();
    expect(directionBox).not.toBeNull();
    expect(directionBox?.x ?? 0).toBeGreaterThan((nameBox?.x ?? 0) + (nameBox?.width ?? 0));
    await expect(canvas.locator('body')).toHaveClass('template-one-page');
    await expect(canvas.locator('.section-icon svg').first()).toBeVisible();
    await expect(canvas.locator('[data-section-id="education"] .section-body')).toBeVisible();
    await expect(canvas.locator('[data-section-id="skills"] li')).toHaveCount(2);
    await expect(canvas.locator('[data-section-id="target"]')).toHaveCount(0);
    await expect(canvas.locator('[data-section-id="languages"]')).toHaveCount(0);

    await page.getByRole('button', { name: '工作经历', exact: true }).click();
    await page.getByRole('button', { name: '添加一项' }).click();
    const organization = canvas.locator('[data-field$=".organization"]').last();
    await expect(organization).toBeVisible();
    await organization.fill('浏览器测试公司');
    await page.getByRole('button', { name: '增大字距' }).click();
    await expect(page.getByRole('status')).toContainText('已保存');
    await expect(canvas.getByText('浏览器测试公司')).toBeVisible();
    expect((await new AxeBuilder({ page }).exclude('iframe').analyze()).violations).toEqual([]);

    const exported = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出 HTML' }).click();
    const file = await exported;
    expect(file.suggestedFilename()).toMatch(/简洁单页-\d{8}\.html$/u);
    await expect(page.getByRole('status')).toContainText('HTML 已导出');

    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      )
      .toBe(true);
    await expect(page.getByRole('navigation', { name: '简历章节' })).toBeVisible();
    await page.getByRole('button', { name: '基本信息', exact: true }).click();
    await expect(page.getByRole('region', { name: '简历排版工具' })).toBeVisible();
    await expect(canvas.locator('[data-field="basicInfo.name"]')).toHaveAttribute(
      'contenteditable',
      'true',
    );
  });
});
