import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  BossCdpSessionProvider,
  ZhilianCdpSessionProvider,
  Job51CdpSessionProvider,
  LiepinCdpSessionProvider,
} from '../src/cdp.js';
import type { PlatformSession } from '@jobhunter/platform-core';
import { readFileSync } from 'node:fs';
import type { ZhilianSearchTemplates } from '../src/index.js';

vi.mock('node:fs/promises', () => ({
  readFile: () => Promise.resolve('9222\n/devtools/browser/test'),
}));

/** 合成 CDP 端点，只统计命令与连接，不读取真实 Chrome。 */
class FakeSocket extends EventTarget {
  static OPEN = 1;
  static instances: FakeSocket[] = [];
  static openDelay = 0;
  static silent = false;
  static failMethod: string | undefined;
  static onCreate: (() => void) | undefined;
  static emptyResourceReads = 0;
  static targetUrl = 'https://www.zhipin.com/web/geek/jobs';
  static extraTargets: { targetId: string; type: string; url: string }[] = [];
  readyState = 0;
  methods: string[] = [];
  commands: { method: string; params?: { targetId?: string; url?: string } }[] = [];
  ownedUrl: string | undefined;
  constructor() {
    super();
    FakeSocket.instances.push(this);
    setTimeout(() => {
      if (this.readyState === 0) {
        this.readyState = 1;
        this.dispatchEvent(new Event('open'));
      }
    }, FakeSocket.openDelay);
  }
  /** 对初始化只读命令返回合成结构。 */
  send(data: string): void {
    const request = JSON.parse(data) as {
      id: number;
      method: string;
      params?: { expression?: string; targetId?: string; url?: string };
    };
    this.methods.push(request.method);
    this.commands.push(request);
    if (FakeSocket.silent) return;
    if (request.method === 'Target.createTarget') FakeSocket.onCreate?.();
    if (request.method === 'Page.navigate') this.ownedUrl = request.params?.url;
    const responses: Record<string, unknown> = {
      'Target.getTargets': {
        targetInfos: [
          { targetId: 'valid', type: 'page', url: FakeSocket.targetUrl },
          ...FakeSocket.extraTargets,
          ...(this.ownedUrl
            ? [{ targetId: 'worker-owned', type: 'page', url: this.ownedUrl }]
            : []),
        ],
      },
      'Target.attachToTarget': { sessionId: 'attached' },
      'Target.createTarget': { targetId: 'worker-owned' },
      'Target.closeTarget': { success: true },
      'Page.navigate': {},
      'Runtime.evaluate': {
        result: {
          value: request.params?.expression?.includes('window._PAGE')
            ? 'page-token'
            : request.method === 'Runtime.evaluate' && FakeSocket.emptyResourceReads-- > 0
              ? '[]'
              : JSON.stringify([
                  'https://www.zhipin.com/wapi/zpgeek/pc/recommend/job/list.json?page=1',
                ]),
        },
      },
      'Network.getCookies': {
        cookies: [
          {
            name: 'session',
            value: 'test-only',
            domain: FakeSocket.targetUrl.includes('liepin.com') ? '.liepin.com' : '.zhipin.com',
            path: '/',
            secure: true,
            expires: -1,
          },
        ],
      },
      'Target.detachFromTarget': {},
    };
    queueMicrotask(() =>
      this.dispatchEvent(
        new MessageEvent('message', {
          data: JSON.stringify({
            id: request.id,
            ...(request.method === FakeSocket.failMethod
              ? { error: { code: -32001, message: 'Session with given id not found' } }
              : { result: responses[request.method] }),
          }),
        }),
      ),
    );
  }
  /** 模拟用户关浏览器或显式释放连接。 */
  close(): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.dispatchEvent(new Event('close'));
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  // Node 原生 AbortSignal.timeout 不随 Vitest 虚拟时钟推进，显式映射到受控计时器。
  vi.spyOn(AbortSignal, 'timeout').mockImplementation((milliseconds) => {
    const controller = new AbortController();
    setTimeout(() => {
      controller.abort();
    }, milliseconds);
    return controller.signal;
  });
  FakeSocket.instances = [];
  FakeSocket.openDelay = 0;
  FakeSocket.silent = false;
  FakeSocket.failMethod = undefined;
  FakeSocket.onCreate = undefined;
  FakeSocket.emptyResourceReads = 0;
  FakeSocket.targetUrl = 'https://www.zhipin.com/web/geek/jobs';
  FakeSocket.extraTargets = [];
  vi.stubGlobal('WebSocket', FakeSocket);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('日常连接新建默认上下文专用页，HTTP 使用自己的页且不刷新', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      Response.json({ code: 0, zpData: { hasMore: false, lid: 'fixture', jobList: [] } }),
    );
  vi.stubGlobal('fetch', fetcher);
  FakeSocket.extraTargets = [
    { targetId: 'other', type: 'page', url: 'https://example.com/?secret=never-expose' },
  ];
  const pending = new BossCdpSessionProvider().connect({}, new AbortController().signal);
  await vi.advanceTimersByTimeAsync(1);
  const session = await pending;
  await expect(session.readNext(new AbortController().signal)).resolves.toMatchObject({
    hasMore: false,
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(FakeSocket.instances).toHaveLength(1);
  expect(FakeSocket.instances[0]?.methods).toContain('Target.getTargets');
  const socket = FakeSocket.instances[0];
  if (!socket) throw new Error('Missing socket');
  expect(socket.commands.filter((command) => command.method === 'Target.createTarget')).toEqual([
    { id: 1, method: 'Target.createTarget', params: { url: 'about:blank' } },
  ]);
  expect(socket.methods.filter((method) => method === 'Page.navigate')).toHaveLength(1);
  expect(
    socket.commands
      .filter((command) => command.method === 'Target.attachToTarget')
      .every((command) => command.params?.targetId === 'worker-owned'),
  ).toBe(true);
  expect(FakeSocket.instances[0]?.methods).not.toContain('Page.reload');
  session.disconnect();
  await vi.advanceTimersByTimeAsync(1);
  expect(
    socket.commands.find((command) => command.method === 'Target.closeTarget')?.params,
  ).toEqual({ targetId: 'worker-owned' });
});

it('已有多个平台页面仍只新建专用页，不返回选择、不枚举用户页面', async () => {
  FakeSocket.extraTargets = [
    { targetId: 'second', type: 'page', url: `${FakeSocket.targetUrl}?secret=never-expose` },
  ];
  const pending = new BossCdpSessionProvider().connect({}, new AbortController().signal);
  await vi.advanceTimersByTimeAsync(1);
  const session = await pending;
  expect(FakeSocket.instances[0]?.methods).not.toContain('Target.getTargets');
  session.disconnect();
  await vi.advanceTimersByTimeAsync(1);
});

it('没有已有平台页仍可创建，初始化失败仅关闭自己的页', async () => {
  FakeSocket.targetUrl = 'https://example.com/';
  FakeSocket.failMethod = 'Network.getCookies';
  const pending = new BossCdpSessionProvider()
    .connect({}, new AbortController().signal)
    .catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(1);
  expect(await pending).toMatchObject({ category: 'session_unavailable' });
  const socket = FakeSocket.instances[0];
  if (!socket) throw new Error('Missing socket');
  expect(socket.methods).not.toContain('Target.getTargets');
  expect(
    socket.commands.find((command) => command.method === 'Target.closeTarget')?.params,
  ).toEqual({ targetId: 'worker-owned' });
  expect(socket.readyState).toBe(3);
});

it('前程无忧专用页先安装监听再导航，重复断开只清理一次', async () => {
  const pending = new Job51CdpSessionProvider().connect({}, new AbortController().signal);
  await vi.advanceTimersByTimeAsync(1);
  const session = await pending;
  const socket = FakeSocket.instances[0];
  if (!socket) throw new Error('Missing socket');
  expect(socket.methods.indexOf('Network.enable')).toBeLessThan(
    socket.methods.indexOf('Page.navigate'),
  );
  expect(socket.commands.find((command) => command.method === 'Page.navigate')?.params).toEqual({
    url: 'https://we.51job.com/pc/search',
  });
  session.disconnect();
  session.disconnect();
  await vi.advanceTimersByTimeAsync(1);
  expect(socket.methods.filter((method) => method === 'Target.closeTarget')).toHaveLength(1);
});

it('新页自然加载前只等待本地资源时间线，不重复导航', async () => {
  FakeSocket.emptyResourceReads = 3;
  const pending = new BossCdpSessionProvider().connect({}, new AbortController().signal);
  await vi.advanceTimersByTimeAsync(1600);
  const session = await pending;
  const socket = FakeSocket.instances[0];
  expect(socket?.methods.filter((method) => method === 'Page.navigate')).toHaveLength(1);
  expect(socket?.methods.filter((method) => method === 'Runtime.evaluate')).toHaveLength(4);
  expect(socket?.methods).not.toContain('Page.reload');
  session.disconnect();
  await vi.advanceTimersByTimeAsync(1);
});

it('创建过程中取消仍接收新页 ID 并清理，不导航到官网', async () => {
  const controller = new AbortController();
  FakeSocket.onCreate = () => {
    controller.abort();
  };
  const pending = new BossCdpSessionProvider()
    .connect({}, controller.signal)
    .catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(1);
  expect(await pending).toMatchObject({ category: 'session_unavailable' });
  const socket = FakeSocket.instances[0];
  expect(socket?.methods).toEqual(['Target.createTarget', 'Target.closeTarget']);
  expect(socket?.readyState).toBe(3);
});

it.each(['zhilian', 'liepin'] as const)('%s 专用页初始化取消只关闭自己的页', async (provider) => {
  const controller = new AbortController();
  const connector =
    provider === 'zhilian' ? new ZhilianCdpSessionProvider() : new LiepinCdpSessionProvider();
  const pending = connector.connect({}, controller.signal).catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(1);
  const socket = FakeSocket.instances[0];
  if (!socket) throw new Error('Missing socket');
  expect(socket.methods.indexOf('Network.enable')).toBeLessThan(
    socket.methods.indexOf('Page.navigate'),
  );
  controller.abort();
  await vi.advanceTimersByTimeAsync(1);
  expect(await pending).toMatchObject({ category: 'session_unavailable' });
  expect(
    socket.commands.find((command) => command.method === 'Target.closeTarget')?.params,
  ).toEqual({ targetId: 'worker-owned' });
  expect(socket.readyState).toBe(3);
});

it('底层断线通知可以退订，晚订阅立即通知且不重连或访问官网', async () => {
  const pending = new BossCdpSessionProvider().connect(
    { portFile: '/fixture/DevToolsActivePort', targetId: 'valid' },
    new AbortController().signal,
  );
  await vi.advanceTimersByTimeAsync(1);
  const session = await pending;
  const removed = vi.fn(),
    listener = vi.fn(),
    late = vi.fn();
  session.onDisconnected?.(removed)();
  session.onDisconnected?.(listener);
  const socket = FakeSocket.instances[0];
  if (!socket) throw new Error('Missing socket');
  const methods = [...socket.methods];
  socket.close();
  session.onDisconnected?.(late);
  expect(removed).not.toHaveBeenCalled();
  expect(listener).toHaveBeenCalledTimes(1);
  expect(late).toHaveBeenCalledTimes(1);
  expect(socket.methods).toEqual(methods);
  expect(FakeSocket.instances).toHaveLength(1);
});

it.each([false, true])('猎聘初始化后通过 HTTP 获取，专用页模式=%s', async (owned) => {
  FakeSocket.targetUrl = 'https://c.liepin.com/';
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      Response.json({ flag: 1, data: { data: [], addData: [], hasNextPage: false } }),
    );
  vi.stubGlobal('fetch', fetcher);
  const pending = new LiepinCdpSessionProvider().connect(
    owned ? {} : { portFile: '/fixture/DevToolsActivePort', targetId: 'valid' },
    new AbortController().signal,
  );
  await vi.advanceTimersByTimeAsync(1);
  const socket = FakeSocket.instances[0];
  if (!socket) throw new Error('Missing socket');
  const event = {
    method: 'Network.requestWillBeSent',
    sessionId: 'attached',
    params: {
      request: {
        method: 'POST',
        url: 'https://api-c.liepin.com/api/com.liepin.csearch.home-recommend-job-new',
        headers: { Accept: 'application/json', Cookie: 'do-not-reuse' },
        postData: JSON.stringify({
          data: {
            operateKind: 'LOGIN',
            sortType: 'PC_STU_HP_NEW',
            selectedExpect: '{}',
            existFallbackResult: false,
          },
        }),
      },
    },
  };
  // 1、无关标签事件不能初始化，正常事件之后停止页面观察但保留授权 Socket。
  socket.dispatchEvent(
    new MessageEvent('message', { data: JSON.stringify({ ...event, sessionId: 'other' }) }),
  );
  expect(fetcher).not.toHaveBeenCalled();
  socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(event) }));
  const session = await pending;
  expect(socket.methods).toEqual([
    owned ? 'Target.createTarget' : 'Target.getTargets',
    'Target.attachToTarget',
    'Network.enable',
    ...(owned ? ['Page.navigate'] : []),
    'Target.detachFromTarget',
  ]);
  await vi.advanceTimersByTimeAsync(130000);
  expect(socket.readyState).toBe(1);
  // 2、显式 next 使用当前 Cookie，既不刷新也不执行页面脚本。
  expect(await session.readNext(new AbortController().signal)).toMatchObject({
    candidates: [],
    hasMore: false,
  });
  expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({ cookie: 'session=test-only' });
  expect(socket.methods.slice(-4)).toEqual([
    'Target.getTargets',
    'Target.attachToTarget',
    'Network.getCookies',
    'Target.detachFromTarget',
  ]);
  expect(FakeSocket.instances).toHaveLength(1);
  session.disconnect();
  await vi.advanceTimersByTimeAsync(1);
  expect(socket.readyState).toBe(3);
  expect(socket.methods.includes('Target.closeTarget')).toBe(owned);
});

it('BOSS 显式浏览器模式不读取凭据、不刷新且保持同一授权连接', async () => {
  const pending = new BossCdpSessionProvider().connect(
    { portFile: '/fixture/DevToolsActivePort', targetId: 'valid', acquisitionMode: 'browser' },
    new AbortController().signal,
  );
  await vi.advanceTimersByTimeAsync(1);
  const session = await pending;
  const socket = FakeSocket.instances[0];
  expect(socket?.methods).toEqual([
    'Target.getTargets',
    'Target.attachToTarget',
    'Page.enable',
    'Network.enable',
  ]);
  await vi.advanceTimersByTimeAsync(130_000);
  expect(socket?.readyState).toBe(1);
  expect(FakeSocket.instances).toHaveLength(1);
  session.disconnect();
  expect(socket?.readyState).toBe(3);
});

it('不将 BOSS 新模式隐式应用于其他平台', async () => {
  await expect(
    new Job51CdpSessionProvider().connect(
      { portFile: '/fixture/DevToolsActivePort', targetId: 'valid', acquisitionMode: 'browser' },
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ category: 'session_unavailable' });
  expect(FakeSocket.instances).toHaveLength(0);
});

it('retains the selected 51job observer beyond initialization without another authorization', async () => {
  // 1、初始化只建立所选页监听，不读取 Cookie 存储或发起职位请求。
  FakeSocket.targetUrl = 'https://we.51job.com/pc/search?keyword=Java';
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      Response.json({ status: '1', resultbody: { job: { items: [], totalCount: 0 } } }),
    );
  vi.stubGlobal('fetch', fetcher);
  const pending = new Job51CdpSessionProvider().connect(
    { portFile: '/fixture/DevToolsActivePort', targetId: 'valid' },
    new AbortController().signal,
  );
  await vi.advanceTimersByTimeAsync(1);
  const session = await pending;
  const socket = FakeSocket.instances[0];
  if (!socket) throw new Error('Missing socket');
  expect(socket.methods).toEqual(['Target.getTargets', 'Target.attachToTarget', 'Network.enable']);
  await vi.advanceTimersByTimeAsync(130_000);
  expect(socket.readyState).toBe(1);
  // 2、只认所选会话；模板事件不发 HTTP，显式 next 才读取。
  const emit = (method: string, params: unknown): boolean =>
    socket.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify({ sessionId: 'attached', method, params }),
      }),
    );
  emit('Network.requestWillBeSent', {
    requestId: 'list',
    request: {
      url: 'https://we.51job.com/api/job/search-pc?api_key=51job&pageSize=20&pageNum=1',
      method: 'GET',
      headers: { accept: 'application/json' },
    },
  });
  emit('Network.requestWillBeSentExtraInfo', {
    requestId: 'list',
    headers: { cookie: 'test-only' },
  });
  emit('Network.responseReceived', { requestId: 'list', response: { status: 200 } });
  expect(fetcher).not.toHaveBeenCalled();
  expect(await session.readNext(new AbortController().signal)).toEqual({
    candidates: [],
    hasMore: false,
    skippedMissingCompanyId: 0,
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  // 3、关闭页面冻结采集但不关闭浏览器连接；显式断开才关闭 socket。
  emit('Target.detachedFromTarget', { sessionId: 'attached' });
  await expect(session.readNext(new AbortController().signal)).rejects.toMatchObject({
    category: 'session_unavailable',
  });
  expect(FakeSocket.instances).toHaveLength(1);
  expect(socket.readyState).toBe(1);
  session.disconnect();
  expect(socket.readyState).toBe(3);
});

/** 完成模拟授权与初始化，返回可跨动作复用的会话。 */
async function connected(signal = new AbortController().signal): Promise<PlatformSession> {
  const pending = new BossCdpSessionProvider().connect(
    { portFile: '/profile/DevToolsActivePort', targetId: 'valid' },
    signal,
  );
  await vi.advanceTimersByTimeAsync(FakeSocket.openDelay + 1);
  return pending;
}

it('reports an expired initialization session without an unhandled rejection or socket leak', async () => {
  // 1、模拟初始化读取完成后标签失效，不连接真实浏览器。
  FakeSocket.failMethod = 'Target.detachFromTarget';
  const pending = new BossCdpSessionProvider().connect(
    { portFile: '/profile/DevToolsActivePort', targetId: 'valid' },
    new AbortController().signal,
  );
  // 2、先挂接拒绝断言，再推进异步命令，确认生产边界将错误收敛为可用性失败。
  const rejected = pending.catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(1);
  expect(await rejected).toMatchObject({ category: 'session_unavailable' });
  expect(FakeSocket.instances).toHaveLength(1);
  expect(FakeSocket.instances[0]?.readyState).toBe(3);
});

it('keeps one authorized socket across HTTP actions and ignores completed connect cancellation', async () => {
  FakeSocket.openDelay = 30_000;
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({
        code: 0,
        zpData: {
          hasMore: false,
          lid: 'root',
          jobList: [
            {
              encryptJobId: 'job1',
              encryptBrandId: 'brand1',
              securityId: 'private-test',
              jobName: '测试职位',
              brandName: '测试公司',
              cityName: '上海',
              salaryDesc: '',
              jobExperience: '',
              jobDegree: '',
            },
          ],
        },
      }),
    )
    .mockResolvedValueOnce(
      Response.json({
        code: 0,
        zpData: {
          jobInfo: { encryptId: 'job1', jobName: '测试职位', postDescription: '测试正文' },
        },
      }),
    );
  vi.stubGlobal('fetch', fetcher);
  const controller = new AbortController();
  const session = await connected(controller.signal);
  controller.abort();
  const socket = FakeSocket.instances[0];
  if (!socket) throw new Error('missing fixture socket');
  const methods = [...socket.methods];
  // 1、请求前只读同步上下文；超过初始化期限后仍复用同一授权 Socket。
  expect((await session.readNext(new AbortController().signal)).candidates).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(130_000);
  expect((await session.readDetail('job1', new AbortController().signal)).description).toBe(
    '测试正文',
  );
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(socket.readyState).toBe(1);
  expect(methods.at(-1)).toBe('Target.detachFromTarget');
  await vi.advanceTimersByTimeAsync(130_000);
  expect(socket.readyState).toBe(1);
  expect(socket.methods).toEqual([...methods, ...methods, ...methods]);
  expect(FakeSocket.instances).toHaveLength(1);
  session.disconnect();
  expect(socket.readyState).toBe(3);
});

it('freezes HTTP failure without closing or reconnecting CDP', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ code: 37 }));
  vi.stubGlobal('fetch', fetcher);
  const session = await connected();
  await expect(session.readNext(new AbortController().signal)).rejects.toMatchObject({
    category: 'access_blocked',
  });
  await expect(session.readNext(new AbortController().signal)).rejects.toMatchObject({
    category: 'session_unavailable',
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(FakeSocket.instances).toHaveLength(1);
  expect(FakeSocket.instances[0]?.readyState).toBe(1);
  session.disconnect();
});

it.each(['cross-origin', 'read-failed'] as const)(
  'refresh context %s never sends stale credentials',
  async (mode) => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const session = await connected();
    if (mode === 'cross-origin') FakeSocket.targetUrl = 'https://example.com/jobs';
    else FakeSocket.failMethod = 'Runtime.evaluate';
    await expect(session.readNext(new AbortController().signal)).rejects.toMatchObject({
      category: 'session_unavailable',
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(FakeSocket.instances).toHaveLength(1);
    expect(FakeSocket.instances[0]?.readyState).toBe(1);
    session.disconnect();
  },
);

it('cancels an in-flight context read without upstream access or closing the authorized socket', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  const session = await connected();
  FakeSocket.silent = true;
  const controller = new AbortController();
  const reading = session.readNext(controller.signal);
  const assertion = expect(reading).rejects.toMatchObject({ category: 'session_unavailable' });
  controller.abort();
  await assertion;
  expect(fetcher).not.toHaveBeenCalled();
  expect(FakeSocket.instances[0]?.readyState).toBe(1);
  session.disconnect();
});

it('invalidates HTTP when Chrome closes and never reconnects automatically', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  const session = await connected();
  FakeSocket.instances[0]?.close();
  await expect(session.readNext(new AbortController().signal)).rejects.toMatchObject({
    category: 'session_unavailable',
  });
  expect(fetcher).not.toHaveBeenCalled();
  expect(FakeSocket.instances).toHaveLength(1);
});

it('closes an authorized socket when a CDP command exceeds its own timeout', async () => {
  FakeSocket.silent = true;
  const pending = new BossCdpSessionProvider().connect(
    { portFile: '/profile/DevToolsActivePort', targetId: 'valid' },
    new AbortController().signal,
  );
  const assertion = expect(pending).rejects.toMatchObject({ category: 'session_unavailable' });
  await vi.advanceTimersByTimeAsync(20_001);
  await assertion;
  expect(FakeSocket.instances[0]?.readyState).toBe(3);
});

it('allows up to two minutes for authorization and cleans up on timeout', async () => {
  FakeSocket.openDelay = 150_000;
  const pending = new BossCdpSessionProvider().connect(
    { portFile: '/profile/DevToolsActivePort', targetId: 'valid' },
    new AbortController().signal,
  );
  const assertion = expect(pending).rejects.toMatchObject({ category: 'session_unavailable' });
  await vi.advanceTimersByTimeAsync(120_001);
  await assertion;
  expect(FakeSocket.instances[0]?.readyState).toBe(3);
});

it('cancels a pending authorization immediately without opening another socket', async () => {
  FakeSocket.openDelay = 60_000;
  const controller = new AbortController();
  const pending = new BossCdpSessionProvider().connect(
    { portFile: '/profile/DevToolsActivePort', targetId: 'valid' },
    controller.signal,
  );
  const assertion = expect(pending).rejects.toMatchObject({ category: 'session_unavailable' });
  await vi.advanceTimersByTimeAsync(1);
  controller.abort();
  await assertion;
  expect(FakeSocket.instances[0]?.readyState).toBe(3);
  expect(FakeSocket.instances).toHaveLength(1);
});

it('rejects broad browser credential paths and malformed targets before connecting', async () => {
  const provider = new BossCdpSessionProvider();
  const signal = new AbortController().signal;
  for (const portFile of [
    'relative/DevToolsActivePort',
    '/profile/Cookies',
    '/profile/Local State',
  ]) {
    await expect(provider.connect({ portFile, targetId: 'valid' }, signal)).rejects.toMatchObject({
      category: 'session_unavailable',
    });
  }
  await expect(
    provider.connect({ portFile: '/profile/DevToolsActivePort', targetId: '../other' }, signal),
  ).rejects.toMatchObject({ category: 'session_unavailable' });
});

it('does not expose filesystem errors or descriptor paths on cancelled connection', async () => {
  const provider = new BossCdpSessionProvider();
  const signal = AbortSignal.abort();
  await expect(
    provider.connect({ portFile: '/private/test/DevToolsActivePort', targetId: 'valid' }, signal),
  ).rejects.toThrow('Platform request failed: session_unavailable');
});

const campusRequest = {
  method: 'POST',
  url: 'https://cgate.zhaopin.com/positionbusiness/searchRecommendCampus/searchRecommendCampusPcSubject?x-zp-page-request-id=one&x-zp-page-request-id=two',
  headers: {
    'x-zp-at': 'secret-at',
    'x-zp-rt': 'secret-rt',
    'x-zp-platform': '14',
    'x-zp-business-system': '40',
  },
  postData: JSON.stringify({
    at: 'secret-at',
    rt: 'secret-rt',
    d: 'secret-d',
    identity: '1',
    filterMinSalary: 1,
    resumeNumber: 'reference',
    subjectType: 1,
    eventScenario: 'campusPcRecommend',
    pageIndex: 1,
    pageSize: 20,
    browsedJobNumbers: '',
    clickedJobNumbers: [],
    channel: 'xiaoyuan',
    platform: '14',
    version: '0.0.0',
  }),
};
/** 合成页面事件，不执行真实浏览器操作或网站请求。 */
function emitCampus(request = campusRequest, sessionId = 'attached'): void {
  FakeSocket.instances[0]?.dispatchEvent(
    new MessageEvent('message', {
      data: JSON.stringify({
        sessionId,
        method: 'Network.requestWillBeSent',
        params: { request },
      }),
    }),
  );
}

it.each([
  ['list-first', false],
  ['detail-first', false],
  ['list-first', true],
  ['detail-first', true],
] as const)(
  'initializes main-site %s templates on one authorized socket, owned=%s',
  async (order, owned) => {
    const fixture = JSON.parse(
      readFileSync(
        new URL('../../../fixtures/platforms/zhilian-search.json', import.meta.url),
        'utf8',
      ),
    ) as { templates: ZhilianSearchTemplates };
    FakeSocket.targetUrl = 'https://www.zhaopin.com/jobs?kw=Java';
    const fetcher = vi.fn().mockResolvedValue(
      Response.json({
        code: 200,
        apiCode: 200,
        data: { statusCode: 200, isVerification: 0, count: 0, isEndPage: 1, list: [] },
      }),
    );
    vi.stubGlobal('fetch', fetcher);
    const pending = new ZhilianCdpSessionProvider().connect(
      owned ? {} : { portFile: '/profile/DevToolsActivePort', targetId: 'valid' },
      new AbortController().signal,
    );
    await vi.advanceTimersByTimeAsync(1);
    const list = {
      method: 'POST',
      url: fixture.templates.list.url,
      headers: { ...fixture.templates.list.headers },
      postData: fixture.templates.list.body,
    };
    const detail = {
      method: 'GET',
      url: fixture.templates.detail.url,
      headers: { ...fixture.templates.detail.headers },
      postData: '',
    };
    emitCampus(campusRequest);
    emitCampus(list, 'foreign');
    emitCampus(order === 'list-first' ? list : detail);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeSocket.instances[0]?.methods.at(-1)).toBe(
      owned ? 'Page.navigate' : 'Network.enable',
    );
    emitCampus(order === 'list-first' ? detail : list);
    const session = await pending;
    expect(await session.readNext(new AbortController().signal)).toMatchObject({ hasMore: false });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(FakeSocket.instances).toHaveLength(1);
    expect(FakeSocket.instances[0]?.methods.slice(-2)).toEqual([
      'Network.disable',
      'Target.detachFromTarget',
    ]);
    session.disconnect();
    await vi.advanceTimersByTimeAsync(1);
  },
);

it('rejects mismatched main-site authentication without upstream requests', async () => {
  const fixture = JSON.parse(
    readFileSync(
      new URL('../../../fixtures/platforms/zhilian-search.json', import.meta.url),
      'utf8',
    ),
  ) as { templates: ZhilianSearchTemplates };
  FakeSocket.targetUrl = 'https://www.zhaopin.com/jobs';
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  const pending = new ZhilianCdpSessionProvider().connect(
    { portFile: '/profile/DevToolsActivePort', targetId: 'valid' },
    new AbortController().signal,
  );
  const assertion = expect(pending).rejects.toThrow('session_unavailable');
  await vi.advanceTimersByTimeAsync(1);
  emitCampus({ method: 'POST', ...fixture.templates.list, postData: fixture.templates.list.body });
  emitCampus({
    method: 'GET',
    ...fixture.templates.detail,
    url: fixture.templates.detail.url.replace('at=fixture-at', 'at=other'),
    postData: '',
  });
  await assertion;
  expect(fetcher).not.toHaveBeenCalled();
  expect(FakeSocket.instances[0]?.readyState).toBe(3);
});

it('captures only the selected campus homepage request and reuses one socket for HTTP', async () => {
  FakeSocket.targetUrl = 'https://xiaoyuan.zhaopin.com/recommend?subjectType=1';
  const fetcher = vi
    .fn()
    .mockResolvedValue(Response.json({ statusCode: 200, data: { list: [], isEndPage: 1 } }));
  vi.stubGlobal('fetch', fetcher);
  const controller = new AbortController();
  const pending = new ZhilianCdpSessionProvider().connect(
    { portFile: '/profile/DevToolsActivePort', targetId: 'valid' },
    controller.signal,
  );
  await vi.advanceTimersByTimeAsync(1);
  expect(FakeSocket.instances[0]?.methods.at(-1)).toBe('Network.enable');
  let settled = false;
  void pending.then(() => {
    settled = true;
  });
  emitCampus(campusRequest, 'other-tab');
  emitCampus({ ...campusRequest, method: 'GET' });
  emitCampus({ ...campusRequest, url: 'https://unrelated.example/request' });
  emitCampus({ ...campusRequest, postData: JSON.stringify({ pageIndex: 2 }) });
  await vi.advanceTimersByTimeAsync(1);
  expect(settled).toBe(false);
  emitCampus();
  const session = await pending;
  controller.abort();
  const socket = FakeSocket.instances[0];
  if (!socket) throw new Error('Missing test socket');
  expect(socket.methods).toEqual([
    'Target.getTargets',
    'Target.attachToTarget',
    'Network.enable',
    'Network.disable',
    'Target.detachFromTarget',
  ]);
  expect(await session.readNext(new AbortController().signal)).toMatchObject({
    candidates: [],
    hasMore: false,
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0]?.[0]).toBe(campusRequest.url);
  await vi.advanceTimersByTimeAsync(130_000);
  expect(socket.readyState).toBe(1);
  expect(FakeSocket.instances).toHaveLength(1);
  socket.close();
  await expect(session.readNext(new AbortController().signal)).rejects.toThrow(
    'session_unavailable',
  );
  session.disconnect();
  expect(socket.readyState).toBe(3);
});

it.each(['timeout', 'cancel', 'closed', 'malformed'] as const)(
  'cleans up campus observation on %s without HTTP or reconnect',
  async (mode) => {
    FakeSocket.targetUrl = 'https://xiaoyuan.zhaopin.com/recommend';
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const controller = new AbortController();
    const pending = new ZhilianCdpSessionProvider().connect(
      { portFile: '/profile/DevToolsActivePort', targetId: 'valid' },
      controller.signal,
    );
    const assertion = expect(pending).rejects.toThrow(
      'Platform request failed: session_unavailable',
    );
    await vi.advanceTimersByTimeAsync(1);
    if (mode === 'cancel') controller.abort();
    else if (mode === 'closed') FakeSocket.instances[0]?.close();
    else if (mode === 'malformed')
      emitCampus({ ...campusRequest, postData: 'invalid-private-body' });
    else await vi.advanceTimersByTimeAsync(120_001);
    await assertion;
    expect(fetcher).not.toHaveBeenCalled();
    expect(FakeSocket.instances).toHaveLength(1);
    expect(FakeSocket.instances[0]?.readyState).toBe(3);
  },
);

it.each([
  'https://www.zhaopin.com/',
  'https://xiaoyuan.zhaopin.com/resume',
  'https://www.zhipin.com/web/geek/jobs',
])('rejects non-campus target %s', async (url) => {
  FakeSocket.targetUrl = url;
  const pending = new ZhilianCdpSessionProvider().connect(
    { portFile: '/profile/DevToolsActivePort', targetId: 'valid' },
    new AbortController().signal,
  );
  const assertion = expect(pending).rejects.toThrow('session_unavailable');
  await vi.advanceTimersByTimeAsync(1);
  await assertion;
  expect(FakeSocket.instances[0]?.methods).toEqual(['Target.getTargets']);
});
