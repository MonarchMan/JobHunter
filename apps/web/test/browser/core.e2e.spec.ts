import { expect, test } from '@playwright/test';

test.describe('校招实习管理台核心流程', () => {
  test('filters internship jobs and links titles to official details', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 900 });
    await page.goto('/jobs');

    await expect(page.getByRole('link', { name: '大模型应用实习生' })).toBeVisible();
    await expect(page.getByRole('link', { name: '历史算法实习生' })).toHaveCount(0);
    await page.locator('.job-filter-panel summary').click();
    await page.getByLabel('关键词').fill('大模型');
    await page.getByRole('button', { name: '应用筛选' }).click();
    await expect(page).toHaveURL(/q=%E5%A4%A7%E6%A8%A1%E5%9E%8B/);

    const link = page.getByRole('link', { name: '大模型应用实习生' }).first();
    await expect(link).toHaveAttribute('href', 'https://careers.tencent.com/campus/agent-intern');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  test('selects jobs and explicitly queues a rules score', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 900 });
    await page.goto('/jobs');
    await page.getByLabel('选择职位：大模型应用实习生').first().check();
    const toolbar = page.locator('.job-selection-toolbar');
    await toolbar.getByText('批量评分（1）').click();
    const scorePanel = page.getByRole('dialog', { name: '选择评分方式' });
    await expect(scorePanel).toBeVisible();
    const triggerBox = await toolbar.getByRole('button', { name: '批量评分（1）' }).boundingBox();
    const panelBox = await scorePanel.boundingBox();
    expect(triggerBox).not.toBeNull();
    expect(panelBox).not.toBeNull();
    if (triggerBox && panelBox) expect(Math.abs(panelBox.y - triggerBox.y)).toBeLessThan(12);
    await scorePanel.getByRole('button', { name: /^规则评分/ }).click();
    await expect(toolbar.getByRole('status')).toContainText('已为 1 个职位创建规则评分任务');
  });

  test('keeps job actions aligned and exposes complete truncated locations', async ({ page }) => {
    await page.goto('/jobs');
    const headers = page.getByRole('columnheader');
    await expect(headers.filter({ hasText: '公司' })).toHaveCount(1);
    await expect(headers.filter({ hasText: '地点' })).toHaveCount(1);
    await expect(page.getByText('类别未注明')).toHaveCount(0);

    const row = page.getByRole('row').filter({ hasText: 'AI 产品实习生' });
    const titleLink = row.getByRole('link', { name: 'AI 产品实习生' });
    await expect(titleLink).toHaveAttribute(
      'href',
      'https://careers.tencent.com/campus/ai-product-intern',
    );
    await expect(titleLink).toHaveAttribute('target', '_blank');
    await expect(titleLink).toHaveAttribute('rel', 'noopener noreferrer');
    const actions = row.locator('.job-row-actions');
    const applyBox = await actions.getByRole('link', { name: '官网投递' }).boundingBox();
    const scoreBox = await actions.getByRole('button', { name: '评分' }).boundingBox();
    expect(applyBox?.y).toBe(scoreBox?.y);

    const location = row.locator('.location-truncate');
    await expect(location).toHaveAttribute('title', /中关村软件园/);
    await location.hover();
    await expect(location.getByRole('tooltip')).toBeVisible();
  });

  test('queues an idempotent source sync without waiting for collection', async ({ page }) => {
    await page.goto('/sources');
    const sourceCard = page
      .locator('.company-source-card')
      .filter({ has: page.getByRole('heading', { name: '腾讯', exact: true }) });
    const overviewHeight = (await sourceCard.locator('.company-source-view').boundingBox())?.height;
    await sourceCard.getByLabel('腾讯招聘渠道').selectOption('internship');
    await expect(sourceCard.getByRole('region', { name: '腾讯 实习来源' })).toBeVisible();
    const channelHeight = (await sourceCard.locator('.company-source-view').boundingBox())?.height;
    expect(overviewHeight).toBeDefined();
    expect(channelHeight).toBeDefined();
    expect(Math.abs((overviewHeight ?? 0) - (channelHeight ?? 0))).toBeLessThan(1);

    const sync = sourceCard.getByRole('button', { name: '立即同步 腾讯实习' });
    await expect(sync).toBeEnabled();
    const sourceHeader = sourceCard.locator('.company-source-header');
    const syncBox = await sync.boundingBox();
    const healthBox = await sourceHeader.locator('.company-health-summary').boundingBox();
    expect(syncBox).not.toBeNull();
    expect(healthBox).not.toBeNull();
    if (syncBox && healthBox) expect(syncBox.x).toBeLessThan(healthBox.x);
    await sync.click();
    await expect(page.getByRole('status')).toContainText('同步任务已创建');
    const firstFeedback = await page.getByRole('status').textContent();

    await sync.click();
    await expect(page.getByRole('status')).toContainText('同步任务已创建');
    await expect(page.getByRole('status')).toHaveText(firstFeedback ?? '');
  });

  test('separates official and platform recruitment sources', async ({ page }) => {
    await page.goto('/sources');
    await expect(page.getByRole('heading', { name: '招聘来源' })).toBeVisible();
    await expect(page.getByRole('link', { name: /官网来源/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.getByRole('link', { name: /招聘平台来源/ })).toBeVisible();

    await page.getByRole('link', { name: /招聘平台来源/ }).click();
    await expect(page).toHaveURL(/channel=platform/);
    await expect(page.getByRole('heading', { name: '招聘平台来源暂未接入' })).toBeVisible();
    await expect(page.getByRole('link', { name: /招聘平台来源/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('updates and locks an internship candidate profile version', async ({ page }) => {
    await page.goto('/profile');
    await expect(page.getByLabel('选择画像')).toHaveValue('018f0000-0000-7000-8000-000000000601');
    const advancedTools = page.locator('summary').filter({
      hasText: '高级维护：字段锁定与 JSON 修正',
    });
    await advancedTools.click();
    await page.getByLabel('JSON Pointer').fill('/targetRoles');
    await page.getByLabel('JSON 值').fill('["Agent 实习生"]');
    await page.getByRole('button', { name: '创建修正版' }).click();
    await expect(page.getByRole('heading', { name: '版本 2' })).toBeVisible();
    await expect(page.locator('pre').filter({ hasText: 'Agent 实习生' })).toHaveCount(2);

    await advancedTools.click();
    await page.getByLabel('JSON Pointer').fill('/targetRoles');
    await page.getByRole('button', { name: '锁定字段' }).click();
    await expect(page.getByRole('heading', { name: '版本 3' })).toBeVisible();
    await advancedTools.click();
    await expect(page.getByText('/targetRoles')).toBeVisible();
    await expect(page.getByRole('button', { name: '解锁' })).toBeVisible();
  });

  test('edits, previews and saves every resume section as one version', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/profile');
    const currentVersionHeading = page.getByRole('heading', { name: /^版本 \d+$/ });
    const currentVersion = Number(
      (await currentVersionHeading.textContent())?.replace('版本 ', ''),
    );
    await expect(page.getByRole('heading', { name: '在线简历' })).toBeVisible();
    const outline = page.getByRole('navigation', { name: '在线简历章节' });
    await expect(outline.getByRole('link')).toHaveCount(11);
    await expect(page.getByRole('heading', { name: '基本信息' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '教育经历' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '作品' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '竞赛' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '证书' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '语言能力' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '专业技能' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '自我评价' })).toBeVisible();
    await expect(page.getByText('RESUME SECTION')).toHaveCount(0);
    const schoolField = page.getByLabel('学校').locator('..');
    const dateRangeField = page.locator('#resume-education .resume-date-range').first();
    const schoolBox = await schoolField.boundingBox();
    const dateRangeBox = await dateRangeField.boundingBox();
    expect(Math.abs((schoolBox?.width ?? 0) - (dateRangeBox?.width ?? 0))).toBeLessThan(1);
    const majorInput = page.getByLabel('专业', { exact: true });
    const firstDateControl = dateRangeField.locator('.iso-date-input').first();
    const majorInputBox = await majorInput.boundingBox();
    const dateControlBox = await firstDateControl.boundingBox();
    expect(Math.abs((majorInputBox?.y ?? 0) - (dateControlBox?.y ?? 0))).toBeLessThan(1);
    const dateRangeTitle = dateRangeField.locator('.resume-date-range-title');
    await expect(dateRangeTitle).toHaveCSS('font-weight', '400');
    const dateGap = await dateRangeField.evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).rowGap),
    );
    const majorGap = await majorInput
      .locator('..')
      .evaluate((element) => Number.parseFloat(getComputedStyle(element).rowGap));
    expect(dateGap).toBeGreaterThan(4);
    expect(Math.abs(dateGap - majorGap)).toBeLessThan(0.1);
    await expect(dateRangeField.locator('.iso-date-display')).toHaveText([
      'YYYY-MM-DD',
      'YYYY-MM-DD',
    ]);

    await page.setViewportSize({ width: 390, height: 844 });
    const basicSection = page.locator('#resume-basic');
    const defaultSectionBackground = await basicSection.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    );
    await basicSection.hover();
    await expect(basicSection).not.toHaveCSS('background-color', defaultSectionBackground);
    const firstStartDate = page.getByLabel('开始日期').first();
    const firstEndDate = page.getByLabel('结束日期').first();
    await expect(firstStartDate).toHaveAttribute('type', 'date');
    await expect(firstStartDate).toHaveAttribute('lang', 'zh-CN');
    await expect(page.getByText('无准确日期时可填写预计日期')).toHaveCount(0);
    await expect(page.getByText('开始日期')).toHaveCount(0);
    await expect(page.getByText('结束日期')).toHaveCount(0);
    const startBox = await firstStartDate.boundingBox();
    const endBox = await firstEndDate.boundingBox();
    expect(Math.abs((startBox?.width ?? 0) - (endBox?.width ?? 0))).toBeLessThan(1);

    await page.getByLabel('姓名').fill('测试候选人');
    await page
      .getByRole('textbox', { name: '专业技能' })
      .fill('熟练使用 TypeScript、React，并具备 Agent 应用开发经验。');
    await page.getByRole('textbox', { name: '自我评价' }).fill('关注产品价值与工程质量。');
    await page.getByRole('button', { name: '添加证书' }).click();
    await page.getByLabel('证书名称').fill('云计算证书');
    await expect(page.getByLabel('取得时间')).toHaveAttribute('type', 'date');
    await page.getByLabel('取得时间').fill('2026-05-20');
    await page.getByRole('button', { name: '添加作品' }).click();
    await page.getByRole('button', { name: '添加经历' }).click();
    await page.getByRole('button', { name: '添加项目' }).click();
    const startDates = page.getByLabel('开始日期');
    const endDates = page.getByLabel('结束日期');
    await expect(startDates).toHaveCount(3);
    await expect(endDates).toHaveCount(3);
    for (let index = 0; index < 3; index += 1) {
      const startDate = startDates.nth(index);
      const endDate = endDates.nth(index);
      await expect(startDate).toHaveAttribute('type', 'date');
      await expect(startDate).toHaveAttribute('lang', 'zh-CN');
      await expect(endDate).toHaveAttribute('type', 'date');
      await expect(endDate).toHaveAttribute('lang', 'zh-CN');
      await startDate.fill(`202${String(index + 2)}-01-0${String(index + 2)}`);
      await endDate.fill(`202${String(index + 2)}-12-1${String(index + 2)}`);
      await expect(startDate.locator('..').locator('.iso-date-display')).toHaveText(
        `202${String(index + 2)}-01-0${String(index + 2)}`,
      );
      await expect(endDate.locator('..').locator('.iso-date-display')).toHaveText(
        `202${String(index + 2)}-12-1${String(index + 2)}`,
      );
    }
    await expect(page.getByRole('textbox', { name: '项目描述' })).toBeVisible();
    await expect(page.getByText('项目成果')).toHaveCount(0);
    const previewButton = page.getByRole('button', { name: '预览' });
    await expect(previewButton.locator('svg')).toHaveCount(0);
    const saveButton = page.getByRole('button', { name: '保存简历' });
    await previewButton.hover();
    const previewBackground = await previewButton.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    );
    await saveButton.hover();
    const saveBackground = await saveButton.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    );
    expect(previewBackground).not.toBe(saveBackground);
    await previewButton.click();
    const dialog = page.getByRole('dialog', { name: '简历预览' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: '测试候选人' })).toBeVisible();
    await expect(dialog.getByRole('heading', { name: '证书' })).toBeVisible();
    await expect(dialog.getByRole('heading', { name: '专业技能' })).toBeVisible();
    await expect(dialog.getByText(/熟练使用 TypeScript/)).toBeVisible();
    await expect(dialog.getByText('云计算证书')).toBeVisible();
    await expect(dialog.getByText('2026-05-20')).toBeVisible();
    await expect(dialog.getByText(/2022-01-02 — 2022-12-12/)).toBeVisible();
    await expect(dialog.getByText(/2023-01-03 — 2023-12-13/)).toBeVisible();
    await expect(dialog.getByText(/2024-01-04 — 2024-12-14/)).toBeVisible();
    await expect(dialog.getByRole('heading', { name: '作品' })).toHaveCount(0);
    const closePreview = dialog.getByRole('button', { name: '关闭预览' });
    await closePreview.hover();
    await expect(closePreview).toHaveCSS('color', 'rgb(28, 33, 48)');
    await expect(closePreview).not.toHaveCSS('background-color', saveBackground);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(previewButton).toBeFocused();

    await page.getByRole('button', { name: '保存简历' }).click();
    await expect(
      page.getByRole('heading', { name: `版本 ${String(currentVersion + 1)}` }),
    ).toBeVisible();
    await expect(page.getByLabel('姓名')).toHaveValue('测试候选人');
    await expect(page.getByRole('heading', { name: '项目经历' })).toBeVisible();
    await expect(page.getByRole('button', { name: /扫描件 OCR 识别/ })).toBeDisabled();
    await expect(page.getByText(/图片型 PDF 的 OCR 识别将在后续版本开放/)).toBeVisible();
  });

  test('shows queued task and redacted Agent trace diagnostics', async ({ page }) => {
    await page.goto('/tasks');
    await expect(page.getByRole('heading', { name: '任务与 Agent 运行' })).toBeVisible();
    await expect(page.getByRole('button', { name: '来源同步' }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'job-understanding' })).toBeVisible();

    await page.getByRole('button', { name: 'job-understanding' }).click();
    await expect(page.getByRole('heading', { name: 'Agent 运行详情' })).toBeVisible();
    await expect(
      page.locator('.truncated-text-value', { hasText: 'fixture.lookup' }),
    ).toBeVisible();
    await expect(page.getByRole('table', { name: '工具调用' })).toBeVisible();
  });
});
