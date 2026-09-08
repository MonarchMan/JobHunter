import { expect, test } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

// 简历制作独占画像，避免核心流程的偏好修改污染初始草稿。
const profileId = '018f0000-0000-7000-8000-000000000621';

test.describe('多模板简历制作', () => {
  test('keeps project paragraphs and bullets in one editor and supports multiline columns', async ({
    page,
  }) => {
    await page.goto(`/profile?profile=${profileId}`);
    const entry = page.locator('[data-resume-template-entry]');
    await entry.getByRole('combobox', { name: '简历模板' }).click();
    await page.getByRole('option', { name: '标准单页' }).click();
    await entry.getByRole('button', { name: '导出', exact: true }).click();
    await page.waitForURL(/\/resume-studio\//u);
    const canvas = page.locator('iframe').contentFrame();
    await page.getByRole('button', { name: '项目经历', exact: true }).click();
    await page.getByRole('button', { name: '添加一项' }).click();
    const descriptionBlock = canvas
      .locator('[data-section-id="projects"] [data-block-id$=".description"]')
      .last();
    const description = descriptionBlock.locator('[data-description]');
    await expect(descriptionBlock.locator('.row-actions')).toHaveCSS('opacity', '0');
    await descriptionBlock.hover();
    await expect(descriptionBlock.locator('.row-actions')).toHaveCSS('opacity', '1');
    await expect(descriptionBlock.locator('.row-actions')).toHaveCSS('position', 'absolute');
    await description.fill('项目介绍');
    await description.press('End');
    await description.press('Enter');
    await description.pressSequentially('第一条职责');
    await description.press('ControlOrMeta+Shift+8');
    await description.press('End');
    await description.press('Enter');
    await description.pressSequentially('第二条职责');
    await expect(description.locator('li')).toHaveCount(2);
    await description.press('Home');
    await description.press('Backspace');
    await expect(description.locator('li')).toHaveCount(1);
    const addCertificate = page.getByRole('button', { name: '新增证书', exact: true });
    if (await addCertificate.isEnabled()) await addCertificate.click();
    await page.getByRole('button', { name: '证书', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('已保存');
    await canvas.locator('[data-section-id="certificates"] .resume-block').last().hover();
    await canvas
      .locator('[data-section-id="certificates"]')
      .getByRole('button', { name: '在本块后新增 1 栏', exact: true })
      .last()
      .click();
    const block = canvas.locator('[data-section-id="certificates"] [data-description]').last();
    await block.fill('完整章节第一段');
    await block.press('End');
    await block.press('Enter');
    await block.pressSequentially('完整章节第二段');
    await page.getByRole('button', { name: '预览', exact: true }).click();
    const preview = page
      .getByRole('dialog', { name: /导出效果预览/u })
      .locator('iframe')
      .contentFrame();
    await expect(preview.getByText('完整章节第二段')).toBeVisible();
    await page.getByRole('button', { name: '关闭预览' }).click();
    await expect(page.getByRole('status')).toContainText('已保存');
    await page.reload();
    await expect(description).toContainText('项目介绍');
    await expect(description.locator('li')).toHaveCount(1);
    await expect(block).toContainText('完整章节第二段');
    // 1、浮动操作针对文本块，删除描述不能误删项目标题。
    const headers = canvas.locator('[data-section-id="projects"] [data-block-id$=".header"]');
    const headerCount = await headers.count();
    await descriptionBlock.hover();
    await descriptionBlock.getByRole('button', { name: '在本块后新增 2 栏', exact: true }).click();
    const inserted = canvas.locator('[data-section-id="projects"] .text-row').last();
    await expect(inserted.locator('.text-cell')).toHaveCount(2);
    await inserted.hover();
    await inserted.getByRole('button', { name: '删除本块', exact: true }).click();
    await descriptionBlock.hover();
    await descriptionBlock.getByRole('button', { name: '删除本块', exact: true }).click();
    await expect(headers).toHaveCount(headerCount);
  });

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
    const saveStatus = page.locator('[data-resume-save-state]');
    const backButton = page.getByRole('button', { name: /返回个人资料/u });
    const backColor = await backButton.evaluate((element) => getComputedStyle(element).color);
    await backButton.hover();
    await expect(backButton).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect
      .poll(() => backButton.evaluate((element) => getComputedStyle(element).color))
      .not.toBe(backColor);
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
    await expect(saveStatus).toContainText('已保存');
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

    const previewButton = page.getByRole('button', { name: '预览', exact: true });
    await previewButton.click();
    const previewDialog = page.getByRole('dialog', { name: /导出效果预览/u });
    await expect(previewDialog).toBeVisible();
    const previewCanvas = previewDialog.locator('iframe').contentFrame();
    await expect(previewCanvas.locator('body')).toHaveClass('template-one-page');
    await expect(previewCanvas.locator('[contenteditable]')).toHaveCount(0);
    await expect(previewCanvas.locator('.is-active')).toHaveCount(0);
    await expect(previewCanvas.locator('[data-section-id="languages"]')).toHaveCount(0);
    await previewDialog.getByRole('button', { name: '返回编辑' }).click();
    await expect(previewDialog).toBeHidden();
    await expect(previewButton).toBeFocused();

    await page.getByRole('button', { name: '工作经历', exact: true }).click();
    await page.getByRole('button', { name: '添加一项' }).click();
    const organization = canvas.locator('[data-field$=".organization"]').last();
    await expect(organization).toBeVisible();
    await organization.fill('浏览器测试公司');
    await page.getByRole('button', { name: '增大字距' }).click();
    await expect(saveStatus).toContainText('已保存');
    await expect(canvas.getByText('浏览器测试公司')).toBeVisible();
    expect((await new AxeBuilder({ page }).exclude('iframe').analyze()).violations).toEqual([]);

    const exported = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出 HTML' }).click();
    const file = await exported;
    expect(file.suggestedFilename()).toMatch(/简洁单页-\d{8}\.html$/u);
    await expect(saveStatus).toContainText('HTML 已导出');

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
