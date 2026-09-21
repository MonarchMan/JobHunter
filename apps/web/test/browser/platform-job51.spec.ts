import { expect, test } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { z } from 'zod';

const taskResponse = z.object({ data: z.object({ taskId: z.string(), kind: z.string() }) });

/** 真实本地 API 验证 provider 隔离与安全；不启动平台采集。 */
test('Job51 API enforces CSRF, rejects private fields and isolates identical tokens', async ({
  request,
  baseURL,
}) => {
  const mutation = {
    command: { action: 'connect', portFile: '/fixture/DevToolsActivePort', targetId: 'fixture' },
    idempotencyToken: crypto.randomUUID(),
  };
  expect((await request.post('/api/platforms/51job', { data: mutation })).status()).toBe(403);
  const csrf = z
    .object({ data: z.object({ token: z.string() }) })
    .parse(await (await request.get('/api/csrf')).json()).data.token;
  if (!baseURL) throw new Error('Missing local test URL');
  const headers = { Origin: baseURL, 'x-jobhunter-csrf': csrf };
  expect(
    (
      await request.post('/api/platforms/51job', {
        headers,
        data: { ...mutation, command: { ...mutation.command, at: 'forbidden' } },
      })
    ).status(),
  ).toBe(400);
  const result = await request.post('/api/platforms/51job', { headers, data: mutation });
  expect(result.status()).toBe(202);
  const first = taskResponse.parse(await result.json()).data;
  expect(
    taskResponse.parse(
      await (await request.post('/api/platforms/51job', { headers, data: mutation })).json(),
    ).data,
  ).toEqual({ ...first, kind: 'idempotent' });
  const boss = taskResponse.parse(
    await (await request.post('/api/platforms/boss', { headers, data: mutation })).json(),
  ).data;
  expect(boss.taskId).not.toBe(first.taskId);
  const snapshot = await request.get('/api/platforms/51job');
  expect(snapshot.headers()['cache-control']).toBe('no-store');
  const rawSnapshot: unknown = await snapshot.json();
  const data = z
    .object({ data: z.object({ task: z.object({ id: z.string() }) }) })
    .parse(rawSnapshot);
  expect(data.data.task.id).toBe(first.taskId);
  expect(JSON.stringify(rawSnapshot)).not.toContain('/fixture');
  expect((await request.get('/api/platforms/zhilian')).status()).toBe(200);
  expect((await request.get('/api/platforms/liepin')).status()).toBe(200);
  expect((await request.get('/api/platforms/unknown')).status()).toBe(404);
});

/** 共享组件覆盖校园／社招入口、保存反馈、失败恢复与平台切换。 */
test('Job51 UI completes explicit browsing, preserves idempotency and separates BOSS', async ({
  page,
}) => {
  const candidate = {
    externalJobId: 'CC_TEST',
    externalCompanyId: 'KA_TEST',
    title: '社招开发工程师',
    company: '测试公司',
    city: '上海',
    salary: '面议',
    experience: '',
    education: '本科',
    sourceUrl: 'https://jobs.51job.com/shanghai/100.html',
  };
  let state: object = { connection: null, batch: null, saved: {}, task: null };
  const commands: { command: { action: string }; idempotencyToken: string }[] = [];
  let reads = 0;
  let uncertain = true;
  await page.route('**/api/platforms/51job', async (route) => {
    if (route.request().method() === 'GET') {
      reads++;
      return route.fulfill({ json: { data: state } });
    }
    const input = z
      .object({ command: z.object({ action: z.string() }), idempotencyToken: z.string() })
      .parse(route.request().postDataJSON());
    commands.push(input);
    if (uncertain) {
      uncertain = false;
      return route.abort();
    }
    if (input.command.action === 'connect')
      state = {
        connection: { generation: 2, status: 'connected' },
        batch: null,
        saved: {},
        task: { id: 'task', status: 'succeeded', error: null },
      };
    else if (input.command.action === 'acquire')
      state = {
        ...state,
        batch: {
          generation: 2,
          candidates: [candidate],
          savedCount: 1,
          hasMore: false,
          skippedMissingCompanyId: 0,
        },
      };
    await route.fulfill({ status: 202, json: { data: { taskId: 'task', kind: 'enqueued' } } });
  });
  await page.route('**/api/platforms/boss', (route) =>
    route.fulfill({ json: { data: { connection: null, batch: null, saved: {}, task: null } } }),
  );
  await page.goto('/sources?channel=platform&provider=51job');
  await page.getByText('高级连接设置', { exact: true }).click();
  await expect(page.getByRole('heading', { name: '前程无忧 · 官网辅助' })).toBeVisible();
  await expect(page.getByText('连接后在专用页正常搜索或翻页', { exact: false })).toBeVisible();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: '连接 Chrome' }).click();
  await expect(page.getByLabel('调试描述文件绝对路径')).toBeFocused();
  await page.getByLabel('调试描述文件绝对路径').fill('/fixture/DevToolsActivePort');
  await page.getByRole('button', { name: '连接 Chrome' }).click();
  await expect(page.getByRole('button', { name: '确认上次提交' })).toBeVisible();
  await page.getByRole('button', { name: '确认上次提交' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: '获取职位' })).toBeEnabled({
    timeout: 10000,
  });
  expect(commands[0]?.idempotencyToken).toBe(commands[1]?.idempotencyToken);
  await page.getByRole('button', { name: '获取职位' }).click();
  await expect(page.getByText('最近成功批次已入库 1 条职位。', { exact: false })).toBeVisible({
    timeout: 10000,
  });
  await expect(page.getByRole('button', { name: '获取职位' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '读取详情并保存' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: '查看平台职位' })).toHaveAttribute(
    'href',
    '/jobs?source=platform&provider=51job',
    { timeout: 10000 },
  );
  expect(commands.map((x) => x.command.action)).toEqual(['connect', 'connect', 'acquire']);
  for (const width of [1280, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => {
      window.scrollTo(0, 0);
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({ path: `test-results/51job-${String(width)}.png`, fullPage: true });
  }
  // 隐藏时停止本地轮询；返回后不补发平台请求。
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const before = reads;
  await page.waitForTimeout(3300);
  expect(reads).toBe(before);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => reads).toBeGreaterThan(before);
  await page.getByRole('link', { name: 'BOSS 直聘', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'BOSS 直聘' })).toBeVisible();
  await expect(page.getByRole('heading', { name: candidate.title })).toHaveCount(0);
  expect(commands).toHaveLength(3);
});
