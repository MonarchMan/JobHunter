import { expect, test } from '@playwright/test';

const deepDossierId = '018f0000-0000-7000-8000-000000000902';

test.describe('深档项目文档拷打', () => {
  test('uploads and freezes selected Markdown while keeping material evidence readable', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 950 });
    await page.goto(`/interview/projects/${deepDossierId}`);

    await expect(page.getByRole('heading', { name: '文档检索网关', level: 1 })).toBeVisible();
    const materials = page.getByRole('region', { name: '项目资料' });
    await expect(materials.getByText('architecture.md', { exact: true })).toBeVisible();

    const archivedQuestion = page
      .getByRole('article')
      .filter({ hasText: '为什么把模型调用放在事务提交之后' });
    await expect(archivedQuestion).toBeVisible();
    await expect(archivedQuestion.getByRole('list', { name: '提问资料依据' })).toContainText(
      'architecture.md · 任务与事务边界',
    );

    await page.getByLabel(/上传 Markdown \/ MDX/).setInputFiles({
      name: 'release-notes.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from(
        ['# 发布复盘', '', 'Worker 重试采用稳定幂等键，数据库只提交短事务。'].join('\n'),
        'utf8',
      ),
    });
    await materials.getByRole('button', { name: '登记资料版本' }).click();
    await expect(page.getByRole('status')).toContainText('已登记 1 份项目资料');
    await expect(materials.getByText('release-notes.md', { exact: true })).toBeVisible();
    await expect(materials.getByText('2 个逻辑文件')).toBeVisible();

    await page.getByLabel('拷打档位').selectOption('docs-grounded');
    await page.getByLabel('architecture.md · v1').check();
    await page.getByLabel('release-notes.md · v1').check();
    await page.getByRole('button', { name: '开始新会话' }).click();

    await expect(
      page.getByLabel('通知').getByRole('status').filter({ hasText: '新一轮拷打已建立' }),
    ).toBeVisible();
    await expect(page.getByText('深档 · docs-grounded@v1')).toBeVisible();
    await expect(page.getByRole('button', { name: '生成第一题' })).toBeVisible();

    const completedSession = page.locator('button[data-status="completed"]');
    await expect(completedSession).toHaveAccessibleName(
      /会话 - \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} 深档 已完成 1 题/u,
    );
    await expect(page.getByText(/第 [12] 轮/u)).toHaveCount(0);
    await expect(page.locator('button[data-status="active"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await completedSession.focus();
    await page.keyboard.press('Enter');
    await expect(archivedQuestion).toBeVisible();
    await expect(page.getByRole('button', { name: '继续此会话' })).toBeVisible();
    await expect(page.getByRole('button', { name: '返回当前会话' })).toBeVisible();
    const [resumeResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes('/api/interview/sessions/') && response.url().endsWith('/state'),
      ),
      page.getByRole('button', { name: '继续此会话' }).click(),
    ]);
    expect(resumeResponse.ok()).toBe(true);
    await expect(page.locator('button[data-status="active"]')).toContainText('1 题');
    await expect(page.locator('button[data-status="paused"]')).toContainText('0 题');
    await expect(page.locator('nav[aria-label="拷打会话"] button').first()).toHaveAttribute(
      'data-status',
      'active',
    );
    await page.getByText('补充或修订上一题回答').click();
    await page.getByLabel('新的完整回答版本').fill('补充后的完整回答');
    await expect(page.getByRole('button', { name: '保存回答修订' })).toBeEnabled();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('region', { name: '拷打会话' })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });
});
