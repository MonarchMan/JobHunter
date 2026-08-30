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
    await page.getByRole('button', { name: '开始拷打' }).click();

    await expect(page.getByRole('status')).toContainText('新一轮拷打已建立');
    await expect(page.getByText('深档 · docs-grounded@v1')).toBeVisible();
    await expect(page.getByRole('button', { name: '生成第一题' })).toBeVisible();

    const detail = await page.evaluate(async (dossierId) => {
      const response = await fetch(`/api/interview/projects/${dossierId}`);
      if (!response.ok) throw new Error('无法读取深档测试详情。');
      return (await response.json()) as {
        data: {
          sessionRecords: readonly {
            status: string;
            profileKey: string;
            materialBindings: readonly { fileName: string }[];
          }[];
        };
      };
    }, deepDossierId);
    expect(detail.data.sessionRecords.find((session) => session.status === 'active')).toMatchObject(
      {
        profileKey: 'docs-grounded',
        materialBindings: [{ fileName: 'architecture.md' }, { fileName: 'release-notes.md' }],
      },
    );
  });
});
