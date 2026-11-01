import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { expect, test, type ConsoleMessage, type Response } from '@playwright/test';

/** 枚举实际页面文件，保证新增页面也必须加入真实浏览器验收。 */
async function routes(directory: string, prefix = ''): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory())
      result.push(...(await routes(path.join(directory, entry.name), `${prefix}/${entry.name}`)));
    else if (entry.name === 'page.tsx') result.push(prefix || '/');
  }
  return result.sort();
}

test('every actual page renders valid data without runtime or server errors', async ({
  page,
  baseURL,
}) => {
  test.setTimeout(120_000);
  if (!baseURL) throw new Error('Missing fixture URL');
  // 1、只在已通过全局身份门禁的隔离夹具中创建动态详情页记录。
  const csrf = z
    .object({ data: z.object({ token: z.string() }) })
    .parse(await (await page.request.get('/api/csrf')).json());
  const headers = { origin: baseURL, 'x-jobhunter-csrf': csrf.data.token };
  const draftResponse = await page.request.post('/api/resume-drafts', {
    headers,
    data: { profileId: '018f0000-0000-7000-8000-000000000631', templateKey: 'clean-single-column' },
  });
  expect(draftResponse.ok(), await draftResponse.text()).toBe(true);
  const draft = z
    .object({ data: z.object({ draft: z.object({ id: z.string() }) }) })
    .parse(await draftResponse.json());
  const experienceResponse = await page.request.post('/api/interview/experiences/online', {
    headers,
    data: {
      company: '页面验收公司',
      role: '工程师',
      stage: '技术面试',
      occurredOn: null,
      outcome: null,
      difficulty: null,
      tags: [],
      notes: null,
      questions: [{ question: '如何保证事务原子性？', answer: null, reflection: null }],
    },
  });
  expect(experienceResponse.ok(), await experienceResponse.text()).toBe(true);
  const experience = z
    .object({ data: z.object({ documentId: z.string() }) })
    .parse(await experienceResponse.json());
  const researchResponse = await page.request.post('/api/interview/research', {
    headers,
    data: {
      targetRoles: ['页面验收工程师'],
      companies: [],
      locations: [],
      levels: [],
      stages: [],
      dateFrom: null,
      dateTo: null,
      language: 'zh-CN',
      maxSources: 1,
      maxQuestionsPerSource: 1,
      allowedDomains: [],
      blockedDomains: [],
    },
  });
  expect(researchResponse.ok(), await researchResponse.text()).toBe(true);
  const research = z
    .object({ data: z.object({ detail: z.object({ request: z.object({ id: z.string() }) }) }) })
    .parse(await researchResponse.json());
  const destinations: Record<string, string> = {
    '/': '/',
    '/jobs': '/jobs',
    '/sources': '/sources',
    '/applications': '/applications',
    '/my': '/my',
    '/interview': '/interview',
    '/interview/experiences': '/interview/experiences',
    '/interview/research': '/interview/research',
    '/tasks': '/tasks',
    '/settings': '/settings',
    '/profile': '/profile',
    '/jobs/[id]': '/jobs/018f0000-0000-7000-8000-000000000401',
    '/agent-runs/[id]': '/agent-runs/018f0000-0000-7000-8000-000000000801',
    '/interview/projects/[id]': '/interview/projects/018f0000-0000-7000-8000-000000000902',
    '/interview/experiences/[id]': `/interview/experiences/${experience.data.documentId}`,
    '/interview/research/[id]': `/interview/research/${research.data.detail.request.id}`,
    '/resume-studio/[draftId]': `/resume-studio/${draft.data.draft.id}`,
  };
  expect(Object.keys(destinations).sort()).toEqual(
    await routes(fileURLToPath(new URL('../../app', import.meta.url))),
  );
  // 2、逐页等待客户端水合，校验 HTTP、标题、控制台与失败资源；真实详情不能以 404 代替。
  const views: readonly (readonly [string, string])[] = [
    ...Object.entries(destinations),
    ['/my?tab=applications', '/my?tab=applications'],
    ['/my?tab=profile', '/my?tab=profile'],
  ];
  for (const [route, destination] of views) {
    await test.step(route, async () => {
      const errors: string[] = [];
      const onError = (error: Error): void => {
        errors.push(error.message);
      };
      const onConsole = (message: ConsoleMessage): void => {
        if (message.type() === 'error') errors.push(message.text());
      };
      const onResponse = (response: Response): void => {
        if (response.status() >= 500) errors.push(`${String(response.status())} ${response.url()}`);
      };
      page.on('pageerror', onError);
      page.on('console', onConsole);
      page.on('response', onResponse);
      try {
        const response = await page.goto(destination);
        expect(response?.status()).toBe(200);
        await expect(page.locator('h1')).toHaveCount(1);
        await expect(page.locator('h1')).toBeVisible();
        await expect(page.getByRole('heading', { name: '404', exact: true })).toHaveCount(0);
        await expect(page.locator('body')).not.toContainText('Application error:');
        await page.waitForLoadState('networkidle');
        expect(errors).toEqual([]);
      } finally {
        page.off('pageerror', onError);
        page.off('console', onConsole);
        page.off('response', onResponse);
      }
    });
  }
});
