import { expect, test } from '@playwright/test';
import { z } from 'zod';

const jobId = '018f0000-0000-7000-8000-000000000401';

/** 本地详情与设置 API 测试，不启动采集 Worker 或访问招聘平台。 */
test('activity POST requires CSRF while GET/prefetch and official jobs do not write', async ({
  request,
  baseURL,
}) => {
  expect((await request.get(`/api/jobs/${jobId}/view`)).status()).toBe(405);
  expect((await request.post(`/api/jobs/${jobId}/view`)).status()).toBe(403);
  // 1. API 的 JSON 响应须经边界校验，避免测试把未定义的令牌误作有效授权。
  const csrf = z
    .object({ data: z.object({ token: z.string() }) })
    .parse(await (await request.get('/api/csrf')).json()).data.token;
  if (!baseURL) throw new Error('Missing local test URL');
  const headers = { Origin: baseURL, 'x-jobhunter-csrf': csrf };
  expect((await request.post('/api/jobs/invalid/view', { headers })).status()).toBe(400);
  const official = await request.post(`/api/jobs/${jobId}/view`, { headers });
  expect(official.status()).toBe(200);
  expect(
    z.object({ data: z.object({ updated: z.boolean() }) }).parse(await official.json()).data,
  ).toEqual({ updated: false });
  const status = await request.get('/api/platforms/retention');
  expect(
    z
      .object({
        data: z.object({
          enabled: z.boolean(),
          policy: z.object({ retentionDays: z.number(), intervalHours: z.number() }),
        }),
      })
      .parse(await status.json()).data,
  ).toEqual({
    enabled: false,
    policy: { retentionDays: 30, intervalHours: 6 },
  });
  expect(status.headers()['cache-control']).toBe('no-store');
});

test('hidden detail waits for visibility, records once and exposes explicit recovery', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
  });
  let requests = 0;
  await page.route(`**/api/jobs/${jobId}/view`, async (route) => {
    requests++;
    await route.fulfill({ status: requests === 1 ? 503 : 200, json: { data: { updated: true } } });
  });
  await page.goto(`/jobs/${jobId}`);
  await expect(page.getByRole('heading', { name: '职位描述' })).toBeVisible();
  // 1、页面已挂载但仍隐藏，不得把预先打开的后台页计为交互。
  await page.waitForTimeout(200);
  expect(requests).toBe(0);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.getByText('浏览记录未保存', { exact: false })).toBeVisible();
  expect(requests).toBe(1);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(100);
  expect(requests).toBe(1);
  // 2、失败仅提供显式重试；保留职位内容和键盘可访问性。
  await page.getByRole('button', { name: '重试记录浏览' }).focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => requests).toBe(2);
  await expect(page.getByText('浏览记录未保存', { exact: false })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('来源卡片不展示或请求职位保留策略', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/platforms/retention')
      requests.push(request.url());
  });
  await Promise.all([
    page.waitForResponse('**/api/platforms/boss'),
    page.goto('/sources?channel=platform'),
  ]);
  await expect(page.getByText('职位保留策略', { exact: true })).toHaveCount(0);
  expect(requests).toEqual([]);
});
