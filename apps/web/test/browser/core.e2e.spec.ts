import { expect, test } from '@playwright/test';

test.describe('校招实习管理台核心流程', () => {
  test('filters internship jobs and opens matching evidence detail', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 900 });
    await page.goto('/jobs');

    await expect(page.getByRole('link', { name: '大模型应用实习生' })).toBeVisible();
    await expect(page.getByRole('link', { name: '历史算法实习生' })).toHaveCount(0);
    await page.getByLabel('关键词').fill('大模型');
    await page.getByRole('button', { name: '应用筛选' }).click();
    await expect(page).toHaveURL(/q=%E5%A4%A7%E6%A8%A1%E5%9E%8B/);

    await page.getByRole('link', { name: '大模型应用实习生' }).click();
    await expect(page.getByRole('heading', { name: '大模型应用实习生' })).toBeVisible();
    await expect(page.getByText('86.5 分')).toBeVisible();
    await expect(page.getByText('具备 TypeScript Agent 项目经验')).toBeVisible();
    await page.getByText('查看资格规则证据').click();
    await expect(page.getByText('学历要求与校招实习画像匹配')).toBeVisible();

    for (const name of ['官网投递 ↗', '官网详情 ↗']) {
      const link = page.getByRole('link', { name });
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      await expect(link).toHaveAttribute('href', /^https:\/\/careers\.tencent\.com\//);
    }
  });

  test('queues an idempotent source sync without waiting for collection', async ({ page }) => {
    await page.goto('/sources');
    const sync = page.getByRole('button', { name: '立即同步 腾讯校招' });
    await expect(sync).toBeEnabled();
    await sync.click();
    await expect(page.getByRole('status')).toContainText('任务已创建：');
    const firstFeedback = await page.getByRole('status').textContent();

    await sync.click();
    await expect(page.getByRole('status')).toContainText('任务已创建：');
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
    await page.getByLabel('JSON Pointer').fill('/targetRoles');
    await page.getByLabel('JSON 值').fill('["Agent 实习生"]');
    await page.getByRole('button', { name: '创建修正版' }).click();
    await expect(page.getByRole('heading', { name: '版本 2' })).toBeVisible();
    await expect(page.locator('pre').filter({ hasText: 'Agent 实习生' })).toHaveCount(2);

    await page.getByLabel('JSON Pointer').fill('/targetRoles');
    await page.getByRole('button', { name: '锁定字段' }).click();
    await expect(page.getByText('/targetRoles')).toBeVisible();
    await expect(page.getByRole('button', { name: '解锁' })).toBeVisible();
  });

  test('shows queued task and redacted Agent trace diagnostics', async ({ page }) => {
    await page.goto('/tasks');
    await expect(page.getByRole('heading', { name: '任务与 Agent 运行' })).toBeVisible();
    await expect(page.getByRole('code').filter({ hasText: 'source.sync' }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'job-understanding' })).toBeVisible();

    await page.getByRole('link', { name: 'job-understanding' }).click();
    await expect(page.getByRole('heading', { name: 'job-understanding' })).toBeVisible();
    await expect(page.getByText('fixture.lookup')).toBeVisible();
    await expect(page.getByRole('heading', { name: '脱敏工具调用' })).toBeVisible();
  });
});
