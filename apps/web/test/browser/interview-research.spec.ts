import { expect, test } from '@playwright/test';

interface CreateResearchResponse {
  readonly data?: {
    readonly detail: {
      readonly request: {
        readonly id: string;
        readonly requestFingerprint: string;
      };
    };
  };
}

test.describe('外部 Agent 网友面经研究', () => {
  test('creates a brief, imports and reviews a bundle, then filters accepted records', async ({
    page,
  }) => {
    const unique = String(Date.now());
    const role = `后端浏览器测试-${unique}`;
    const firstCompany = `研究公司甲-${unique}`;
    const secondCompany = `研究公司乙-${unique}`;
    const firstSourceTitle = `后端一面记录-${unique}`;
    const secondSourceTitle = `系统设计记录-${unique}`;

    await page.setViewportSize({ width: 1280, height: 950 });
    await page.goto('/interview/research');

    await expect(page.getByRole('heading', { name: '网友面经', level: 1 })).toBeVisible();
    const brief = page.locator('form').filter({
      has: page.getByRole('button', { name: '创建研究 Brief' }),
    });
    await brief.getByLabel('目标岗位').fill(role);
    await brief.getByLabel('目标公司').fill(`${firstCompany}、${secondCompany}`);
    await brief.getByLabel('面试阶段').fill('技术一面、系统设计');
    await brief.getByLabel('只允许这些域名（可选）').fill('nowcoder.com');

    const creation = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/interview/research',
    );
    await brief.getByRole('button', { name: '创建研究 Brief' }).click();
    const creationResponse = await creation;
    expect(creationResponse.ok()).toBe(true);
    const created = (await creationResponse.json()) as CreateResearchResponse;
    const request = created.data?.detail.request;
    expect(request).toBeDefined();
    if (!request) throw new Error('Research creation response did not include a request.');

    await expect(page).toHaveURL(`/interview/research/${request.id}`);
    await expect(page.getByRole('heading', { name: role, level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: '下载 .md' })).toHaveAttribute(
      'href',
      `/api/interview/research/${request.id}/prompt`,
    );
    await expect(page.getByRole('link', { name: '下载 .json' })).toHaveAttribute(
      'href',
      `/api/interview/research/${request.id}/schema`,
    );
    await expect(page.getByRole('combobox', { name: '研究执行方式' })).toHaveText(
      '受限浏览器增强（推荐）',
    );

    const origin = new URL(page.url()).origin;
    const [promptResponse, schemaResponse] = await Promise.all([
      page.request.get(`${origin}/api/interview/research/${request.id}/prompt`),
      page.request.get(`${origin}/api/interview/research/${request.id}/schema`),
    ]);
    expect(promptResponse.ok()).toBe(true);
    expect(promptResponse.headers()['content-type']).toContain('text/markdown');
    const prompt = await promptResponse.text();
    expect(prompt).toContain(role);
    expect(prompt).toContain(request.requestFingerprint);
    expect(prompt).toContain('community-research-prompt@v3');

    expect(schemaResponse.ok()).toBe(true);
    expect(schemaResponse.headers()['content-type']).toContain('application/schema+json');
    const schema = (await schemaResponse.json()) as {
      readonly properties?: {
        readonly schemaVersion?: { readonly const?: string };
      };
    };
    expect(schema.properties?.schemaVersion?.const).toBe('community-research-bundle@v1');

    const bundle = {
      schemaVersion: 'community-research-bundle@v1',
      requestFingerprint: request.requestFingerprint,
      generatedAt: '2026-08-30T08:00:00.000Z',
      sources: [
        {
          url: 'https://nowcoder.com/interviews/browser-backend',
          title: firstSourceTitle,
          publishedAt: '2026-08-20T08:00:00.000Z',
          retrievedAt: '2026-08-30T07:00:00.000Z',
        },
        {
          url: 'https://nowcoder.com/interviews/browser-system-design',
          title: secondSourceTitle,
          publishedAt: '2026-08-21T08:00:00.000Z',
          retrievedAt: '2026-08-30T07:10:00.000Z',
        },
      ],
      experiences: [
        {
          company: firstCompany,
          role,
          stage: '技术一面',
          occurredAt: '2026-08-18',
          sourceUrl: 'https://nowcoder.com/interviews/browser-backend',
          questions: [
            {
              text: '如何保证后台任务重复执行时的数据一致性？',
              answerExcerpt: '原文提到幂等键、唯一约束和短事务。',
              topics: ['幂等性', '数据库'],
              evidenceExcerpt: '候选人记录了任务恢复和重复投递问题。',
            },
          ],
        },
        {
          company: secondCompany,
          role,
          stage: '系统设计',
          occurredAt: '2026-08-19',
          sourceUrl: 'https://nowcoder.com/interviews/browser-system-design',
          questions: [
            {
              text: '如何设计可追溯的异步任务系统？',
              answerExcerpt: null,
              topics: ['系统设计'],
              evidenceExcerpt: '原文列出了任务状态、重试和审计要求。',
            },
          ],
        },
      ],
      warnings: ['来源内容尚未由 JobHunter 独立核验。'],
    };
    await page.getByLabel('选择 Agent 返回的 JSON').setInputFiles({
      name: 'browser-community-research.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(bundle)),
    });
    const bundleImport = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === `/api/interview/research/${request.id}/bundles`,
    );
    await page.getByRole('button', { name: '校验并导入候选' }).click();
    expect((await bundleImport).ok()).toBe(true);
    await expect(page.getByRole('status')).toContainText('已导入 2 份候选面经');
    await expect(page.getByRole('heading', { name: '研究包警告' })).toBeVisible();

    const reviewQueue = page.locator('section[aria-labelledby="candidate-review-title"]');
    const firstCandidate = reviewQueue.getByRole('article').filter({ hasText: firstSourceTitle });
    await firstCandidate.getByRole('button', { name: '接受' }).click();
    await expect(page.getByRole('status')).toContainText('候选已进入网友面经');
    await expect(firstCandidate).toHaveCount(0);

    const secondCandidate = reviewQueue.getByRole('article').filter({ hasText: secondSourceTitle });
    await secondCandidate.getByRole('button', { name: '接受' }).click();
    await expect(page.getByRole('status')).toContainText('候选已进入网友面经');
    await expect(secondCandidate).toHaveCount(0);
    await expect(page.getByText('请求：已完成')).toBeVisible();

    await page.getByRole('link', { name: '返回研究列表' }).click();
    await expect(page.getByRole('heading', { name: '已接受的网友面经' })).toBeVisible();
    await expect(page.getByRole('heading', { name: firstSourceTitle })).toBeVisible();
    await expect(page.getByRole('heading', { name: secondSourceTitle })).toBeVisible();

    const acceptedArchive = page.getByRole('region', { name: '已接受的网友面经' });
    await acceptedArchive.getByRole('combobox', { name: '公司' }).selectOption(firstCompany);
    await acceptedArchive.getByRole('combobox', { name: '岗位' }).selectOption(role);
    await acceptedArchive.getByRole('combobox', { name: '阶段' }).selectOption('技术一面');
    await acceptedArchive.getByRole('button', { name: '应用筛选' }).click();
    await expect
      .poll(() => Object.fromEntries(new URL(page.url()).searchParams.entries()))
      .toEqual({ company: firstCompany, role, stage: '技术一面' });
    await expect(page.getByRole('heading', { name: firstSourceTitle })).toBeVisible();
    await expect(page.getByRole('heading', { name: secondSourceTitle })).toHaveCount(0);
    await expect(
      page.getByRole('link', { name: `${firstSourceTitle}（在新窗口打开来源）` }),
    ).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(page.getByText('外部内容 · 未核验')).toBeVisible();

    await page.getByRole('link', { name: '清除' }).click();
    await expect(page.getByRole('heading', { name: secondSourceTitle })).toBeVisible();
  });
});
