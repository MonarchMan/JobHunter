import { expect, test } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { z } from 'zod';

const taskResponse = z.object({ data: z.object({ taskId: z.string(), kind: z.string() }) });

/** 真实本地 API 验证 provider 隔离与安全；不启动平台采集。 */
test('Zhilian API enforces CSRF, rejects private fields and isolates identical tokens', async ({
  request,
  baseURL,
}) => {
  const mutation = {
    command: { action: 'connect', portFile: '/fixture/DevToolsActivePort', targetId: 'fixture' },
    idempotencyToken: crypto.randomUUID(),
  };
  expect((await request.post('/api/platforms/zhilian', { data: mutation })).status()).toBe(403);
  const csrf = z
    .object({ data: z.object({ token: z.string() }) })
    .parse(await (await request.get('/api/csrf')).json()).data.token;
  if (!baseURL) throw new Error('Missing local test URL');
  const headers = { Origin: baseURL, 'x-jobhunter-csrf': csrf };
  expect(
    (
      await request.post('/api/platforms/zhilian', {
        headers,
        data: { ...mutation, command: { ...mutation.command, at: 'forbidden' } },
      })
    ).status(),
  ).toBe(400);
  const result = await request.post('/api/platforms/zhilian', { headers, data: mutation });
  expect(result.status()).toBe(202);
  const first = taskResponse.parse(await result.json()).data;
  expect(
    taskResponse.parse(
      await (await request.post('/api/platforms/zhilian', { headers, data: mutation })).json(),
    ).data,
  ).toEqual({ ...first, kind: 'idempotent' });
  const boss = taskResponse.parse(
    await (await request.post('/api/platforms/boss', { headers, data: mutation })).json(),
  ).data;
  expect(boss.taskId).not.toBe(first.taskId);
  const snapshot = await request.get('/api/platforms/zhilian');
  expect(snapshot.headers()['cache-control']).toBe('no-store');
  const rawSnapshot: unknown = await snapshot.json();
  const data = z
    .object({ data: z.object({ task: z.object({ id: z.string() }) }) })
    .parse(rawSnapshot);
  expect(data.data.task.id).toBe(first.taskId);
  expect(JSON.stringify(rawSnapshot)).not.toContain('/fixture');
  expect((await request.get('/api/platforms/51job')).status()).toBe(200);
  expect((await request.get('/api/platforms/liepin')).status()).toBe(200);
});

/** 共享组件覆盖校园／社招入口、保存反馈、失败恢复与平台切换。 */
test('Zhilian UI completes explicit browsing, preserves idempotency and separates BOSS', async ({
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
    sourceUrl: 'https://www.zhaopin.com/jobdetail/CC_TEST.htm',
  };
  let state: object = { connection: null, batch: null, saved: {}, task: null };
  const commands: {
    command: {
      action: string;
      profileSearch?: true;
      search?: { keyword: string; city: string } | undefined;
    };
    idempotencyToken: string;
  }[] = [];
  let reads = 0;
  let uncertain = true;
  await page.route('**/api/platforms/zhilian', async (route) => {
    if (route.request().method() === 'GET') {
      reads++;
      return route.fulfill({ json: { data: state } });
    }
    const input = z
      .object({
        command: z.object({
          action: z.string(),
          profileSearch: z.literal(true).optional(),
          search: z.object({ keyword: z.string(), city: z.string() }).optional(),
        }),
        idempotencyToken: z.string(),
      })
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
  await page.goto('/sources?channel=platform&provider=zhilian');
  await page.getByText('高级连接设置', { exact: true }).click();
  await expect(page.getByRole('heading', { name: '智联招聘 · 校园／社招' })).toBeVisible();
  await expect(page.getByText('只使用意向岗位原词搜索', { exact: false })).toBeVisible();
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
    '/jobs?source=platform&provider=zhilian',
    { timeout: 10000 },
  );
  expect(commands.map((x) => x.command.action)).toEqual(['connect', 'connect', 'acquire']);
  expect(commands[0]?.command.profileSearch).toBe(true);
  expect(commands[2]?.command.profileSearch).toBe(true);
  expect(commands[2]?.command.search).toBeUndefined();
  for (const width of [1280, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => {
      window.scrollTo(0, 0);
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({ path: `test-results/zhilian-${String(width)}.png`, fullPage: true });
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

/** 日常入口只提交使用资料的意图，不复制关键词或认证字段。 */
test('智联日常获取使用资料词集，拒绝提交时仍保留预览', async ({ page }) => {
  const commands: unknown[] = [];
  await page.route('**/api/platforms/zhilian', (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill({
        json: {
          data: {
            connection: null,
            batch: null,
            saved: {},
            task: null,
            profileSearch: { keywords: ['Java开发工程师'], error: null },
          },
        },
      });
    commands.push(route.request().postDataJSON());
    return route.fulfill({ status: 400, json: { error: { message: '测试拒绝，保留输入' } } });
  });
  await page.goto('/sources?channel=platform&provider=zhilian');
  await page.getByRole('checkbox').check();
  await expect(
    page.getByText('默认第一份资料的意向岗位：Java开发工程师。', { exact: false }),
  ).toBeVisible();
  await expect(page.getByLabel('搜索关键词')).toHaveCount(0);
  expect(commands).toHaveLength(0);
  await page.getByRole('button', { name: '获取职位' }).click();
  await expect(page.getByText('测试拒绝，保留输入')).toBeVisible();
  expect(commands).toHaveLength(1);
  expect(commands[0]).toMatchObject({
    command: { action: 'acquire', generation: null, profileSearch: true },
  });
  await expect(
    page.getByText('默认第一份资料的意向岗位：Java开发工程师。', { exact: false }),
  ).toBeVisible();
});

test('资料缺少具体意向词时禁止请求并提供资料编辑入口', async ({ page }) => {
  const mutations: unknown[] = [];
  await page.route('**/api/platforms/zhilian', (route) => {
    if (route.request().method() !== 'GET') mutations.push(route.request().postDataJSON());
    return route.fulfill({
      json: {
        data: {
          connection: null,
          batch: null,
          saved: {},
          task: null,
          profileSearch: { keywords: [], error: '请先填写具体意向岗位。' },
        },
      },
    });
  });
  await page.goto('/jobs?source=platform&provider=zhilian');
  await expect(page.getByText('请先填写具体意向岗位。')).toBeVisible();
  await page.getByRole('checkbox', { name: /允许自动连接/ }).check();
  await expect(page.getByRole('button', { name: '获取职位', exact: true })).toBeDisabled();
  await expect(page.getByRole('link', { name: '编辑意向岗位' })).toHaveAttribute(
    'href',
    '/profile#resume-intention',
  );
  expect(mutations).toEqual([]);
});
