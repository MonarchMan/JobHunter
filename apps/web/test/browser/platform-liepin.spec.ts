import { expect, test } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { z } from 'zod';

/** 真实本地 API 验证猎聘注册、CSRF 与跨平台幂等隔离，不访问官网。 */
test('Liepin API isolates tasks and rejects credentials', async ({ request, baseURL }) => {
  const command = {
    action: 'connect',
    portFile: '/fixture/DevToolsActivePort',
    targetId: 'fixture',
  };
  const data = { command, idempotencyToken: crypto.randomUUID() };
  expect((await request.post('/api/platforms/liepin', { data })).status()).toBe(403);
  const csrf = z
    .object({ data: z.object({ token: z.string() }) })
    .parse(await (await request.get('/api/csrf')).json());
  if (!baseURL) throw new Error('Missing base URL');
  const headers = { Origin: baseURL, 'x-jobhunter-csrf': csrf.data.token };
  expect(
    (
      await request.post('/api/platforms/liepin', {
        headers,
        data: { ...data, command: { ...command, cookie: 'forbidden' } },
      })
    ).status(),
  ).toBe(400);
  const schema = z.object({ data: z.object({ taskId: z.string(), kind: z.string() }) });
  const first = schema.parse(
    await (await request.post('/api/platforms/liepin', { headers, data })).json(),
  ).data;
  expect(
    schema.parse(await (await request.post('/api/platforms/liepin', { headers, data })).json())
      .data,
  ).toEqual({ ...first, kind: 'idempotent' });
  const other = schema.parse(
    await (await request.post('/api/platforms/51job', { headers, data })).json(),
  ).data;
  expect(other.taskId).not.toBe(first.taskId);
  const snapshot = await request.get('/api/platforms/liepin');
  expect(snapshot.headers()['cache-control']).toBe('no-store');
  expect(await snapshot.text()).not.toContain('/fixture');
});

/** 共享 UI 的猎聘入口覆盖错误恢复、键盘、整批反馈、职位入口和窄屏。 */
test('Liepin UI keeps explicit batches and uses unified jobs', async ({ page }) => {
  let state: object = { connection: null, batch: null, saved: {}, task: null };
  let uncertain = true;
  const commands: { command: { action: string }; idempotencyToken: string }[] = [];
  await page.route('**/api/platforms/liepin', async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { data: state } });
    const input = z
      .object({ command: z.object({ action: z.string() }), idempotencyToken: z.string() })
      .parse(route.request().postDataJSON());
    commands.push(input);
    if (uncertain) {
      uncertain = false;
      return route.abort();
    }
    state = {
      connection: { generation: 1, status: 'connected' },
      saved: {},
      task: { id: 'task', status: 'succeeded', error: null },
      batch:
        input.command.action === 'next'
          ? {
              generation: 1,
              candidates: [],
              savedCount: 0,
              hasMore: false,
              skippedMissingCompanyId: 2,
            }
          : null,
    };
    return route.fulfill({ status: 202, json: { data: { taskId: 'task', kind: 'enqueued' } } });
  });
  await page.goto('/sources?channel=platform&provider=liepin');
  await expect(page.getByRole('heading', { name: '猎聘 · 学生推荐' })).toBeVisible();
  await expect(page.getByText('后续批次和详情通过 HTTP 获取', { exact: false })).toBeVisible();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: '连接 Chrome' }).click();
  await expect(page.getByLabel('调试描述文件绝对路径')).toBeFocused();
  await page.getByLabel('调试描述文件绝对路径').fill('/fixture/DevToolsActivePort');
  await page.getByLabel('目标标签页 ID').fill('fixture');
  await page.getByRole('button', { name: '连接 Chrome' }).click();
  await page.getByRole('button', { name: '确认上次提交' }).focus();
  await page.keyboard.press('Enter');
  const next = page.getByRole('button', { name: '读取下一批职位' });
  await expect(next).toBeEnabled({ timeout: 10000 });
  expect(commands[0]?.idempotencyToken).toBe(commands[1]?.idempotencyToken);
  await next.click();
  await expect(page.getByText('最近成功批次已入库 0 条职位。', { exact: false })).toBeVisible({
    timeout: 10000,
  });
  await expect(next).toBeDisabled({ timeout: 10000 });
  await expect(page.getByRole('link', { name: '查看平台职位' })).toHaveAttribute(
    'href',
    '/jobs?source=platform&provider=liepin',
  );
  await expect(page.getByRole('button', { name: '读取详情并保存' })).toHaveCount(0);
  expect(commands.map((c) => c.command.action)).toEqual(['connect', 'connect', 'next']);
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({ path: `test-results/liepin-${String(width)}.png`, fullPage: true });
  }
  // 3、统一职位页的返回入口保留 provider，不跳回默认 BOSS。
  await page.getByRole('link', { name: '查看平台职位' }).click();
  await expect(page).toHaveURL(/source=platform&provider=liepin/);
  await expect(page.locator('a[href="/sources?channel=platform&provider=liepin"]')).toBeVisible();
});
