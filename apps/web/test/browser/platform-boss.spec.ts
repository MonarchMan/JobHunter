import { expect, test } from '@playwright/test';
import { z } from 'zod';

/** 校验任务发布响应，避免直接访问未验证的 JSON 字段。 */
const taskResponse = z.object({ data: z.object({ taskId: z.string(), kind: z.string() }) });

/** 只验证自有页面和本地 API，浏览器测试绝不访问真实招聘平台。 */
test('BOSS API enforces CSRF, validates input and reuses an idempotent task', async ({
  request,
  baseURL,
}) => {
  const mutation = {
    command: { action: 'connect', portFile: '/fixture/DevToolsActivePort', targetId: 'fixture' },
    idempotencyToken: crypto.randomUUID(),
  };
  expect((await request.post('/api/platforms/boss', { data: mutation })).status()).toBe(403);
  const csrf = await request.get('/api/csrf');
  const body = z.object({ data: z.object({ token: z.string() }) }).parse(await csrf.json());
  if (!baseURL) throw new Error('Missing local test URL');
  const headers = { Origin: baseURL, 'x-jobhunter-csrf': body.data.token };
  expect(
    (
      await request.post('/api/platforms/boss', {
        headers,
        data: { ...mutation, cookie: 'forbidden' },
      })
    ).status(),
  ).toBe(400);
  const first = await request.post('/api/platforms/boss', { headers, data: mutation });
  expect(first.status()).toBe(202);
  const task = taskResponse.parse(await first.json()).data;
  const second = await request.post('/api/platforms/boss', { headers, data: mutation });
  expect(taskResponse.parse(await second.json()).data).toEqual({ ...task, kind: 'idempotent' });
  // 1、字段断言使用校验后的结构，敏感值检查仍覆盖未经裁剪的完整响应。
  const rawSnapshot: unknown = await (await request.get('/api/platforms/boss')).json();
  const snapshot = z
    .object({ data: z.object({ task: z.object({ id: z.string() }) }) })
    .parse(rawSnapshot);
  expect(snapshot.data.task.id).toBe(task.taskId);
  expect(JSON.stringify(rawSnapshot)).not.toContain('/fixture');
});

test('BOSS browsing preserves results on failure and exposes saved jobs at narrow widths', async ({
  page,
}) => {
  let state: unknown = { connection: null, batch: null, saved: {}, task: null };
  const commands: Record<string, unknown>[] = [];
  await page.route('**/api/platforms/boss', async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { data: state } });
    commands.push(z.record(z.string(), z.unknown()).parse(route.request().postDataJSON()));
    state = {
      connection: { generation: 2, status: 'connected' },
      batch: null,
      saved: {},
      task: { id: 'test', status: 'succeeded', error: null },
    };
    await route.fulfill({ status: 202, json: { data: { taskId: 'test', kind: 'enqueued' } } });
  });
  await page.goto('/sources?channel=platform');
  await expect(page.getByText('每次只读取一批', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: '连接 Chrome' })).toBeDisabled();
  await page.getByLabel('调试描述文件绝对路径').fill('/fixture/DevToolsActivePort');
  await page.getByLabel('目标标签页 ID').fill('fixture');
  await page.getByRole('checkbox').check();
  await page.getByLabel('调试描述文件绝对路径').fill('relative');
  await page.getByRole('button', { name: '连接 Chrome' }).click();
  await expect(page.getByLabel('调试描述文件绝对路径')).toBeFocused();
  await expect(page.locator('#boss-path-error')).toContainText('绝对文件路径');
  expect(commands).toHaveLength(0);
  await page.getByLabel('调试描述文件绝对路径').fill('/fixture/DevToolsActivePort');
  await page.getByRole('button', { name: '连接 Chrome' }).click();
  await expect(page.getByRole('button', { name: '读取下一批推荐' })).toBeEnabled({
    timeout: 10000,
  });
  expect(commands).toHaveLength(1);
  const candidate = {
    externalJobId: 'fixture',
    externalCompanyId: 'brand',
    title: '平台开发工程师',
    company: '测试公司',
    city: '上海',
    salary: '20-30K',
    experience: '3年',
    education: '本科',
    sourceUrl: 'https://www.zhipin.com/job_detail/fixture.html',
  };
  state = {
    connection: { generation: 2, status: 'available' },
    batch: {
      generation: 2,
      status: 'available',
      candidates: [candidate],
      hasMore: true,
      skippedMissingCompanyId: 2,
      savedCount: 1,
    },
    saved: {},
    task: { id: 'test', status: 'succeeded', error: null },
  };
  await expect(page.getByText('最近成功批次已入库 1 条职位。', { exact: false })).toBeVisible({
    timeout: 10000,
  });
  await expect(page.getByRole('button', { name: '读取详情并保存' })).toHaveCount(0);
  state = {
    ...(state as object),
    saved: { fixture: 'saved-job' },
    connection: { generation: 2, status: 'access_blocked' },
    task: { id: 'test', status: 'failed', error: '平台限制访问，请检查 Chrome。' },
  };
  await expect(page.getByRole('link', { name: '查看平台职位' })).toHaveAttribute(
    'href',
    '/jobs?source=platform&provider=boss',
    { timeout: 10000 },
  );
  await expect(page.getByRole('button', { name: '读取下一批推荐' })).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'test-results/boss-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
  await page.screenshot({ path: 'test-results/boss-desktop.png', fullPage: true });
  await page.reload();
  await expect(page.getByRole('link', { name: '查看平台职位' })).toBeVisible({ timeout: 10000 });
  expect(commands).toHaveLength(1);
});
