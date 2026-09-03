import { expect, test } from '@playwright/test';

test.describe('校招实习管理台核心流程', () => {
  test('creates a resume-project drill and exposes the real queued question task', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/interview');

    await expect(page.getByRole('heading', { name: '简历项目拷打' })).toBeVisible();
    const projectSource = page.locator('[data-project-source]');
    const dossierArchive = page.locator('[data-dossier-archive]');
    const sourceBox = await projectSource.boundingBox();
    const archiveBox = await dossierArchive.boundingBox();
    expect(sourceBox).not.toBeNull();
    expect(archiveBox).not.toBeNull();
    if (sourceBox && archiveBox) {
      expect(archiveBox.x).toBeGreaterThan(sourceBox.x + sourceBox.width);
      expect(sourceBox.width).toBeGreaterThan(archiveBox.width);
    }
    const project = page.getByRole('article').filter({ hasText: '校招职位 Agent' });
    await project.getByRole('button', { name: '建立准备档案' }).click();
    await expect(page).toHaveURL(/\/interview\/projects\//);
    await expect(page.getByText('浅档 · 尚未开始')).toBeVisible();

    await page.getByRole('button', { name: '开始拷打' }).click();
    await expect(page.getByRole('status')).toContainText('新一轮拷打已建立');
    await expect(page.getByText('浅档 · resume-only@v1')).toBeVisible();
    await page.getByRole('button', { name: '生成第一题' }).click();
    await expect(page.getByRole('heading', { name: '正在生成问题' })).toBeVisible();
    await expect(page.getByRole('link', { name: '查看任务状态' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '准备覆盖' })).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('link', { name: '面试', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      )
      .toBe(true);

    await page.goto('/interview');
    await expect(page.locator('[data-active-session="true"]')).toHaveCount(1);
    const narrowSourceBox = await page.locator('[data-project-source]').boundingBox();
    const narrowArchiveBox = await page.locator('[data-dossier-archive]').boundingBox();
    expect(narrowSourceBox).not.toBeNull();
    expect(narrowArchiveBox).not.toBeNull();
    if (narrowSourceBox && narrowArchiveBox) {
      expect(Math.abs(narrowSourceBox.x - narrowArchiveBox.x)).toBeLessThanOrEqual(1);
      expect(narrowArchiveBox.y).toBeGreaterThan(narrowSourceBox.y + narrowSourceBox.height);
    }
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      )
      .toBe(true);
  });

  test('filters internship jobs and links titles to official details', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 900 });
    await page.goto('/jobs');

    await expect(page.getByRole('link', { name: '大模型应用实习生' })).toBeVisible();
    await expect(page.getByRole('link', { name: '历史算法实习生' })).toHaveCount(0);
    await page
      .locator('details')
      .filter({ hasText: '筛选职位' })
      .getByText(/^筛选职位/)
      .click();
    await page.getByLabel('关键词').fill('大模型');
    await page.getByRole('button', { name: '应用筛选' }).click();
    await expect(page).toHaveURL(/q=%E5%A4%A7%E6%A8%A1%E5%9E%8B/);

    const link = page.getByRole('link', { name: '大模型应用实习生' }).first();
    await expect(link).toHaveAttribute('href', 'https://careers.tencent.com/campus/agent-intern');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  test('opens authored job filters below their triggers and submits their values', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/jobs?category=internship');
    const filterPanel = page.locator('details').filter({ hasText: '筛选职位' });
    const selectLabels = ['招聘类别', '职位类别', '状态', '排序', '个人资料版本'];
    await expect(filterPanel.locator('[data-authored-select-trigger]')).toHaveCount(5);

    for (const label of selectLabels) {
      const currentTrigger = filterPanel.getByRole('combobox', { name: label });
      const triggerBox = await currentTrigger.boundingBox();
      await currentTrigger.click();
      const currentListbox = page.getByRole('listbox');
      const currentContent = page.locator('[data-authored-select-content]');
      await expect(currentListbox).toBeVisible();

      const listboxBox = await currentContent.boundingBox();
      expect(triggerBox).not.toBeNull();
      expect(listboxBox).not.toBeNull();
      if (triggerBox && listboxBox) {
        expect(Math.abs(listboxBox.width - triggerBox.width)).toBeLessThanOrEqual(1);
        expect(Math.abs(listboxBox.x - triggerBox.x)).toBeLessThanOrEqual(1);
        expect(listboxBox.y).toBeGreaterThan(triggerBox.y + triggerBox.height);
      }

      await page.keyboard.press('Escape');
      await expect(currentListbox).toBeHidden();
      await expect(currentTrigger).toBeFocused();
    }

    await filterPanel.getByRole('combobox', { name: '招聘类别' }).click();
    await page.getByRole('option', { name: '校招', exact: true }).click();
    const subfamilyTrigger = filterPanel.getByRole('combobox', { name: '职位类别' });
    await subfamilyTrigger.click();
    await page.getByRole('option', { name: '后端', exact: true }).press('Enter');
    await expect(subfamilyTrigger).toHaveText(/后端/);
    await expect(subfamilyTrigger).toBeFocused();
    await filterPanel.getByRole('combobox', { name: '状态' }).click();
    await page.getByRole('option', { name: '仅在招', exact: true }).click();
    await filterPanel.getByRole('combobox', { name: '排序' }).click();
    await page.getByRole('option', { name: '最近发布', exact: true }).click();
    await filterPanel.getByRole('combobox', { name: '个人资料版本' }).click();
    await page.getByRole('option', { name: '不使用资料匹配', exact: true }).click();
    await filterPanel.getByRole('button', { name: '应用筛选' }).click();
    await expect
      .poll(() => {
        const parameters = new URL(page.url()).searchParams;
        return {
          category: parameters.get('category'),
          subfamily: parameters.get('subfamily'),
          status: parameters.get('status'),
          sort: parameters.get('sort'),
          profile: parameters.get('profile'),
        };
      })
      .toEqual({
        category: 'campus',
        subfamily: '后端',
        status: 'active',
        sort: 'published_desc',
        profile: '',
      });

    await page.setViewportSize({ width: 390, height: 844 });
    await subfamilyTrigger.click();
    const listbox = page.getByRole('listbox');
    await expect(listbox).toBeVisible();
    const narrowBox = await page.locator('[data-authored-select-content]').boundingBox();
    expect(narrowBox).not.toBeNull();
    if (narrowBox) {
      expect(narrowBox.x).toBeGreaterThanOrEqual(0);
      expect(narrowBox.x + narrowBox.width).toBeLessThanOrEqual(390);
    }
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      )
      .toBe(true);
  });

  test('selects jobs and explicitly queues a rules score', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 900 });
    await page.goto('/jobs');
    await page.getByLabel('选择职位：大模型应用实习生').first().check();
    const scoreTrigger = page.getByRole('button', { name: '批量评分（1）' });
    await scoreTrigger.click();
    const scorePanel = page.getByRole('dialog', { name: '选择评分方式' });
    await expect(scorePanel).toBeVisible();
    const triggerBox = await scoreTrigger.boundingBox();
    const panelBox = await scorePanel.boundingBox();
    expect(triggerBox).not.toBeNull();
    expect(panelBox).not.toBeNull();
    if (triggerBox && panelBox) expect(Math.abs(panelBox.y - triggerBox.y)).toBeLessThan(12);
    await scorePanel.getByRole('button', { name: /^规则评分/ }).click();
    await expect(page.getByRole('status')).toContainText('已为 1 个职位创建规则评分任务');
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
    const applyBox = await row.getByRole('link', { name: '官网投递' }).boundingBox();
    const scoreBox = await row.getByRole('button', { name: '评分' }).boundingBox();
    expect(applyBox?.y).toBe(scoreBox?.y);

    const location = row.locator('.location-truncate');
    await expect(location).toHaveAttribute('title', /中关村软件园/);
    await location.hover();
    await expect(location.getByRole('tooltip')).toBeVisible();
  });

  test('queues an idempotent source sync without waiting for collection', async ({ page }) => {
    await page.goto('/sources?page=2');
    const sourceCard = page.locator('[data-company-source-card]').filter({
      has: page.getByRole('heading', { name: '腾讯校招' }),
    });
    await expect(sourceCard).toHaveCount(1);
    const sync = sourceCard.getByRole('button', { name: /^立即同步 / });
    await expect(sync).toBeEnabled();
    await expect(sync.locator('svg')).toBeVisible();
    await sync.hover();
    await expect(sync.getByRole('tooltip', { name: '立即同步' })).toBeVisible();
    const sourceHeader = sourceCard.locator('[data-company-source-header]');
    const sourceCardBox = await sourceCard.boundingBox();
    const syncBox = await sync.boundingBox();
    const health = sourceHeader.locator('[data-company-health-indicator]');
    const healthBox = await health.boundingBox();
    expect(syncBox).not.toBeNull();
    expect(healthBox).not.toBeNull();
    expect(sourceCardBox).not.toBeNull();
    if (sourceCardBox) expect(sourceCardBox.height).toBeLessThan(560);
    await expect(sourceCard).toHaveAttribute('data-health-status', 'healthy');
    await expect(health).toHaveAccessibleName('综合状态：健康');
    await expect(health).toContainText('健康');
    expect(await sourceCard.evaluate((element) => getComputedStyle(element).boxShadow)).toContain(
      'inset',
    );
    const selectorBox = await sourceHeader.locator('[data-company-channel-selector]').boundingBox();
    const actionsBox = await sourceHeader
      .locator('[data-company-source-header-actions]')
      .boundingBox();
    expect(selectorBox).not.toBeNull();
    expect(actionsBox).not.toBeNull();
    if (selectorBox && actionsBox) {
      expect(
        Math.abs(selectorBox.y + selectorBox.height / 2 - (actionsBox.y + actionsBox.height / 2)),
      ).toBeLessThan(1);
    }
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

    const tabs = page.getByRole('navigation', { name: '招聘来源分类' });
    const allSync = page.getByRole('button', { name: '全部同步 全部官网来源' });
    await expect(allSync.locator('svg')).toBeVisible();
    const tabsBox = await tabs.boundingBox();
    const allSyncBox = await allSync.boundingBox();
    expect(tabsBox).not.toBeNull();
    expect(allSyncBox).not.toBeNull();
    if (tabsBox && allSyncBox) {
      expect(
        Math.abs(tabsBox.y + tabsBox.height / 2 - (allSyncBox.y + allSyncBox.height / 2)),
      ).toBeLessThan(1);
    }
    await allSync.focus();
    await expect(allSync.getByRole('tooltip', { name: '全部同步' })).toBeVisible();
    await allSync.click();
    await expect(page.getByRole('status')).toContainText('同步任务');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(allSync).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      )
      .toBe(true);

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
    const profileSelector = page.getByRole('combobox', { name: '选择画像' });
    await expect(profileSelector).toHaveText(/画像/);
    await expect(page.locator('header form input[name="profile"]')).toHaveValue(
      '018f0000-0000-7000-8000-000000000601',
    );
    const profileTriggerBox = await profileSelector.boundingBox();
    await profileSelector.click();
    const profileListbox = page.getByRole('listbox');
    await expect(profileListbox).toBeVisible();
    const profileListboxBox = await page.locator('[data-authored-select-content]').boundingBox();
    expect(profileTriggerBox).not.toBeNull();
    expect(profileListboxBox).not.toBeNull();
    if (profileTriggerBox && profileListboxBox) {
      expect(Math.abs(profileListboxBox.width - profileTriggerBox.width)).toBeLessThanOrEqual(1);
      expect(profileListboxBox.y).toBeGreaterThan(profileTriggerBox.y + profileTriggerBox.height);
    }
    await page.keyboard.press('Escape');
    await expect(profileListbox).toBeHidden();
    await expect(profileSelector).toBeFocused();
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

  test('keeps the resume section outline visible, current and responsive', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1100 });
    await page.goto('/profile');
    const outline = page.getByRole('navigation', { name: '在线简历章节' });
    const resumeDocument = page.locator('[data-resume-edit-document]');

    await expect(outline.getByRole('link')).toHaveCount(11);
    await expect(outline.getByRole('link', { name: '基本信息' })).toHaveAttribute(
      'aria-current',
      'location',
    );
    const desktopOutlineBox = await outline.boundingBox();
    const desktopDocumentBox = await resumeDocument.boundingBox();
    expect(desktopOutlineBox).not.toBeNull();
    expect(desktopDocumentBox).not.toBeNull();
    if (desktopOutlineBox && desktopDocumentBox) {
      expect(desktopOutlineBox.x).toBeGreaterThan(desktopDocumentBox.x + desktopDocumentBox.width);
    }

    await page.locator('#resume-projects').evaluate((element) => {
      element.scrollIntoView({ block: 'start' });
    });
    await expect(outline.getByRole('link', { name: '项目经历' })).toHaveAttribute(
      'aria-current',
      'location',
    );
    await expect(outline).toHaveCSS('position', 'sticky');
    expect((await outline.boundingBox())?.y).toBeLessThan(24);

    const worksLink = outline.getByRole('link', { name: '作品', exact: true });
    const competitionsLink = outline.getByRole('link', { name: '竞赛', exact: true });
    await worksLink.click();
    await expect(page).toHaveURL(/#resume-works$/);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => {
              resolve();
            });
          });
        }),
    );
    await expect(worksLink).toHaveAttribute('aria-current', 'location');
    await expect(competitionsLink).not.toHaveAttribute('aria-current', 'location');
    await expect
      .poll(() =>
        page.locator('[data-resume-edit-document] > section').evaluateAll((sections) => {
          return sections.find((section) => section.getBoundingClientRect().top >= 0)?.id;
        }),
      )
      .toBe('resume-works');

    const collapseOutline = outline.getByRole('button', { name: '收起章节目录' });
    await collapseOutline.focus();
    await page.keyboard.press('Enter');
    await expect(outline.getByRole('link')).toHaveCount(0);
    const expandOutline = outline.getByRole('button', { name: '展开章节目录' });
    await expect(expandOutline).toBeFocused();
    await expandOutline.click();
    await expect(outline.getByRole('link')).toHaveCount(11);

    await page.setViewportSize({ width: 390, height: 844 });
    const mobileOutlineBox = await outline.boundingBox();
    const mobileDocumentBox = await resumeDocument.boundingBox();
    expect(mobileOutlineBox).not.toBeNull();
    expect(mobileDocumentBox).not.toBeNull();
    if (mobileOutlineBox && mobileDocumentBox) {
      expect(Math.abs(mobileOutlineBox.x - mobileDocumentBox.x)).toBeLessThan(1);
      expect(Math.abs(mobileOutlineBox.width - mobileDocumentBox.width)).toBeLessThan(1);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      ),
    ).toBe(false);
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
    const dateRangeField = page.locator('#resume-education [data-resume-date-range]').first();
    const schoolBox = await schoolField.boundingBox();
    const dateRangeBox = await dateRangeField.boundingBox();
    expect(Math.abs((schoolBox?.width ?? 0) - (dateRangeBox?.width ?? 0))).toBeLessThan(1);
    const majorInput = page.getByLabel('专业', { exact: true });
    const firstDateControl = dateRangeField.locator('[data-iso-date-input]').first();
    const majorInputBox = await majorInput.boundingBox();
    const dateControlBox = await firstDateControl.boundingBox();
    expect(Math.abs((majorInputBox?.y ?? 0) - (dateControlBox?.y ?? 0))).toBeLessThan(1);
    const dateRangeTitle = dateRangeField.locator('[data-resume-date-range-title]');
    await expect(dateRangeTitle).toHaveCSS('font-weight', '400');
    const dateGap = await dateRangeField.evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).rowGap),
    );
    const majorGap = await majorInput
      .locator('..')
      .evaluate((element) => Number.parseFloat(getComputedStyle(element).rowGap));
    expect(dateGap).toBeGreaterThan(4);
    expect(Math.abs(dateGap - majorGap)).toBeLessThan(0.1);
    await expect(dateRangeField.locator('[data-iso-date-display]')).toHaveText([
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
      await expect(startDate.locator('..').locator('[data-iso-date-display]')).toHaveText(
        `202${String(index + 2)}-01-0${String(index + 2)}`,
      );
      await expect(endDate.locator('..').locator('[data-iso-date-display]')).toHaveText(
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
    await expect(page.getByText(/JPEG 和 PNG 会进入后台 OCR/)).toBeVisible();
    await expect(page.locator('input[type="file"]')).toHaveAttribute('accept', /image\/jpeg/);
    await expect(page.getByText(/图片型 PDF 暂不支持 OCR/)).toBeVisible();
  });

  test('saves partially completed resume entries with stable placeholder names', async ({
    page,
  }) => {
    await page.goto('/profile');
    const currentVersionHeading = page.getByRole('heading', { name: /^版本 \d+$/ });
    const currentVersion = Number(
      (await currentVersionHeading.textContent())?.replace('版本 ', ''),
    );

    await page.getByRole('button', { name: '添加经历' }).click();
    await page.getByLabel('职位').last().fill('');
    await page.getByLabel('公司 / 组织').last().fill('测试组织');
    await page.getByRole('button', { name: '添加项目' }).click();
    await page.getByLabel('项目名称').last().fill('');
    await page.getByRole('textbox', { name: '项目描述' }).last().fill('保留这段项目描述。');
    await page.getByRole('button', { name: '添加证书' }).click();
    await page.getByLabel('证书名称').last().fill('');
    await page.getByLabel('颁发机构').last().fill('测试机构');

    await page.getByRole('button', { name: '保存简历' }).click();
    await expect(
      page.getByRole('heading', { name: `版本 ${String(currentVersion + 1)}` }),
    ).toBeVisible();
    await expect(page.getByLabel('职位').last()).toHaveValue('待填写职位');
    await expect(page.getByLabel('项目名称').last()).toHaveValue('待填写项目');
    await expect(page.getByLabel('证书名称').last()).toHaveValue('待填写证书');
  });

  test('previews AI polish suggestions and applies only the selected section to the draft', async ({
    page,
  }) => {
    await page.goto('/profile');
    const sourceVersionId = await page.evaluate(async () => {
      const profileResponse = await fetch('/api/profile');
      const profileBody = (await profileResponse.json()) as {
        data: {
          detail: {
            profile: { id: string };
            current: { id: string; effective: Record<string, unknown> };
          };
        };
      };
      const csrfResponse = await fetch('/api/csrf');
      const csrfBody = (await csrfResponse.json()) as { data: { token: string } };
      const detail = profileBody.data.detail;
      const mutationResponse = await fetch('/api/profile', {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'x-jobhunter-csrf': csrfBody.data.token,
        },
        body: JSON.stringify({
          kind: 'replace',
          profileId: detail.profile.id,
          expectedVersionId: detail.current.id,
          profile: {
            ...detail.current.effective,
            targetRoles: ['研发'],
            projects: [
              {
                name: '任务调度系统',
                role: '后端开发',
                startDate: null,
                endDate: null,
                highlights: ['开发失败任务重试功能'],
                evidence: [],
              },
            ],
          },
        }),
      });
      if (!mutationResponse.ok) throw new Error('Failed to prepare resume polish fixture.');
      const mutationBody = (await mutationResponse.json()) as { data: { current: { id: string } } };
      return mutationBody.data.current.id;
    });
    await page.reload();
    const panel = page.locator('[data-resume-polish]');
    await expect(panel.getByRole('heading', { name: '按求职意向润色经历' })).toBeVisible();
    await expect(panel.getByText('仅优化表达，不新增事实')).toBeVisible();
    const panelBox = await panel.boundingBox();
    expect(panelBox?.height).toBeLessThan(220);
    const projectOption = panel.getByLabel('项目经历');
    await expect
      .poll(() =>
        projectOption.evaluate((checkbox) => {
          const style = window.getComputedStyle(checkbox);
          const label = checkbox.closest('label');
          const copy = label?.querySelector('span');
          return {
            checkboxHeight: style.height,
            checkboxWidth: style.width,
            labelHeight: label ? window.getComputedStyle(label).height : '',
            writingMode: copy ? window.getComputedStyle(copy).writingMode : '',
          };
        }),
      )
      .toEqual({
        checkboxHeight: '16px',
        checkboxWidth: '16px',
        labelHeight: '40px',
        writingMode: 'horizontal-tb',
      });
    const projectDescriptions = page.getByRole('textbox', { name: '项目描述' });
    const projectCount = await projectDescriptions.count();
    expect(projectCount).toBeGreaterThan(0);

    const taskId = '018f0000-0000-7000-8000-000000000710';
    const suggestionId = '018f0000-0000-7000-8000-000000000711';
    await page.route('**/api/profile/polish*', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 202,
          contentType: 'application/json',
          body: JSON.stringify({
            data: {
              suggestionId,
              task: {
                taskId,
                status: 'pending',
                deduplicated: false,
                statusUrl: `/api/profile/polish?task=${taskId}&suggestion=${suggestionId}`,
              },
            },
          }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            suggestionId,
            status: 'succeeded',
            errorSummary: null,
            suggestion: {
              sourceVersionId,
              sections: ['projects'],
              result: {
                workExperience: null,
                projects: Array.from({ length: projectCount }, (_, index) => [
                  `围绕目标岗位优化第 ${String(index + 1)} 项已有项目描述。`,
                ]),
              },
            },
          },
        }),
      });
    });

    await panel.getByRole('button', { name: '生成 AI 润色建议' }).click();
    await expect(panel.getByRole('alert')).toContainText('至少选择一项');
    await projectOption.focus();
    await page.keyboard.press('Space');
    await expect(projectOption).toBeChecked();
    await panel.getByRole('button', { name: '生成 AI 润色建议' }).click();
    await expect(panel.getByText('预览润色建议')).toBeVisible({ timeout: 5_000 });
    await expect(panel.getByText(/围绕目标岗位优化第 1 项已有项目描述/)).toBeVisible();
    await expect(projectDescriptions.first()).not.toHaveValue(/围绕目标岗位优化/);

    await panel.getByRole('button', { name: '应用到草稿' }).click();
    await expect(projectDescriptions.first()).toHaveValue('围绕目标岗位优化第 1 项已有项目描述。');
    await expect(page.getByText('有尚未保存的修改')).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(panel).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      )
      .toBe(true);
  });

  test('shows queued task and redacted Agent trace diagnostics', async ({ page }) => {
    await page.goto('/tasks');
    await expect(page.getByRole('heading', { name: '任务与 Agent 运行' })).toBeVisible();
    const taskFilters = page.getByRole('form', { name: '任务筛选' });
    await expect(taskFilters.locator('select:not([aria-hidden="true"])')).toHaveCount(0);
    await expect(taskFilters.locator('[data-authored-select-trigger]')).toHaveCount(2);
    await taskFilters.getByRole('combobox', { name: '状态' }).click();
    await page.getByRole('option', { name: '失败' }).click();
    await taskFilters.getByRole('button', { name: '应用筛选' }).click();
    await expect(page).toHaveURL(/(?:\?|&)status=failed(?:&|$)/);
    await page.goto('/tasks');
    const taskTitle = page.getByRole('button', { name: '来源同步' }).first();
    await expect(taskTitle).toBeVisible();
    await expect(page.getByRole('button', { name: 'job-understanding' })).toBeVisible();
    const titleColor = await taskTitle.evaluate((element) => getComputedStyle(element).color);
    await taskTitle.hover();
    await expect(taskTitle).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect
      .poll(() => taskTitle.evaluate((element) => getComputedStyle(element).color))
      .not.toBe(titleColor);
    const taskTable = page.getByRole('table', { name: '后台任务列表' });
    await expect(taskTable.getByRole('columnheader').first()).toHaveCSS('text-align', 'center');
    await expect(taskTable.getByRole('cell').first()).toHaveCSS('text-align', 'center');
    await expect(taskTable.getByRole('cell').first()).toHaveCSS('vertical-align', 'middle');

    await page.getByRole('button', { name: 'job-understanding' }).click();
    await expect(page.getByRole('heading', { name: 'Agent 运行详情' })).toBeVisible();
    const toolTable = page.getByRole('table', { name: '工具调用' });
    await expect(toolTable.getByText('fixture.lookup', { exact: true }).first()).toBeVisible();
    await expect(toolTable).toBeVisible();
  });

  test('requires confirming a target role before source sync', async ({ page }) => {
    await page.goto('/sources');
    const originalTargetRoles = await page.evaluate(async () => {
      const profileResponse = await fetch('/api/profile');
      const profileBody = (await profileResponse.json()) as {
        data: {
          detail: {
            profile: { id: string };
            current: { id: string; effective: { targetRoles: string[] } };
          };
        };
      };
      const csrfResponse = await fetch('/api/csrf');
      const csrfBody = (await csrfResponse.json()) as { data: { token: string } };
      const detail = profileBody.data.detail;
      const mutationResponse = await fetch('/api/profile', {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'x-jobhunter-csrf': csrfBody.data.token,
        },
        body: JSON.stringify({
          kind: 'set',
          profileId: detail.profile.id,
          expectedVersionId: detail.current.id,
          pointer: '/targetRoles',
          value: [],
        }),
      });
      if (!mutationResponse.ok) throw new Error('Failed to clear target roles.');
      return detail.current.effective.targetRoles;
    });

    await page.goto('/sources');
    await expect(page.getByRole('heading', { name: '确认目标岗位后再同步' })).toBeVisible();
    await expect(page.getByRole('link', { name: '去确认目标岗位' })).toHaveAttribute(
      'href',
      '/profile#resume-intention',
    );
    await expect(page.getByRole('button', { name: '全部同步 全部官网来源' })).toBeDisabled();
    await expect(page.getByRole('button', { name: /^立即同步 / }).first()).toBeDisabled();

    await page.evaluate(async (targetRoles) => {
      const profileResponse = await fetch('/api/profile');
      const profileBody = (await profileResponse.json()) as {
        data: { detail: { profile: { id: string }; current: { id: string } } };
      };
      const csrfResponse = await fetch('/api/csrf');
      const csrfBody = (await csrfResponse.json()) as { data: { token: string } };
      const detail = profileBody.data.detail;
      const mutationResponse = await fetch('/api/profile', {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'x-jobhunter-csrf': csrfBody.data.token,
        },
        body: JSON.stringify({
          kind: 'set',
          profileId: detail.profile.id,
          expectedVersionId: detail.current.id,
          pointer: '/targetRoles',
          value: targetRoles,
        }),
      });
      if (!mutationResponse.ok) throw new Error('Failed to restore target roles.');
    }, originalTargetRoles);
  });

  test('uses shared authored selects throughout the profile page', async ({ page }) => {
    await page.goto('/profile');
    await expect(page.locator('select:not([aria-hidden="true"])')).toHaveCount(0);
    await expect(page.locator('[data-authored-select-trigger]')).toHaveCount(6);

    const targetRole = page.getByRole('combobox', { name: '目标岗位' });
    await expect(targetRole).not.toHaveText('');
    await targetRole.click();
    const targetRoleBox = await page
      .locator('[data-authored-select-trigger][aria-label="目标岗位"]')
      .boundingBox();
    const targetRoleContent = page.locator('[data-authored-select-content]');
    const targetRoleContentBox = await targetRoleContent.boundingBox();
    expect(targetRoleBox).not.toBeNull();
    expect(targetRoleContentBox).not.toBeNull();
    if (targetRoleBox && targetRoleContentBox) {
      expect(Math.abs(targetRoleContentBox.width - targetRoleBox.width)).toBeLessThanOrEqual(1);
      expect(targetRoleContentBox.y).toBeGreaterThan(targetRoleBox.y + targetRoleBox.height);
    }
    await expect(page.getByRole('option', { name: '请选择职位大类' })).toHaveCount(1);
    await expect(page.getByRole('option', { name: '其他', exact: true })).toHaveCount(0);
    await page.getByRole('option', { name: '产品', exact: true }).click();
    await expect(targetRole).toHaveText(/产品/);
    await expect(page.locator('input[name="targetRole"]')).toHaveValue('产品');

    const remoteAccepted = page.getByRole('combobox', { name: '接受远程' }).first();
    await remoteAccepted.click();
    await page.getByRole('option', { name: '接受', exact: true }).click();
    await expect(remoteAccepted).toHaveText(/接受/);
    await expect(page.locator('input[name="remoteAccepted"]')).toHaveValue('true');

    const managementExperience = page.getByRole('combobox', { name: '管理经验' });
    await managementExperience.click();
    await page.getByRole('option', { name: '有', exact: true }).click();
    await expect(page.locator('input[name="managementExperience"]')).toHaveValue('true');

    await page.locator('summary').filter({ hasText: '高级维护：字段锁定与 JSON 修正' }).click();
    const maintenanceRemote = page.getByRole('combobox', { name: '接受远程' }).nth(1);
    await maintenanceRemote.click();
    await page.getByRole('option', { name: '是', exact: true }).click();
    await expect(page.locator('input[name="preferencesRemoteAccepted"]')).toHaveValue('true');
  });
});
