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
  static responseBodies = new Map<string, unknown>();
  static targetUrl = 'https://www.zhipin.com/web/geek/jobs';
  static extraTargets: { targetId: string; type: string; url: string }[] = [];
  static bossAuth = false;
  static bossSecurity = 'old';
  static bossAutoSecurityReturn = false;
  static bossMissingLink = false;
  readyState = 0;
  methods: string[] = [];
  commands: {
    method: string;
    params?: { targetId?: string; url?: string; expression?: string };
  }[] = [];
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
      params?: { expression?: string; targetId?: string; url?: string; requestId?: string };
    };
    this.methods.push(request.method);
    this.commands.push(request);
    if (FakeSocket.silent) return;
    if (request.method === 'Target.createTarget') FakeSocket.onCreate?.();
    if (
      FakeSocket.bossAuth &&
      !FakeSocket.bossMissingLink &&
      request.params?.expression?.includes('link.click()')
    )
      FakeSocket.bossSecurity = 'new';
    if (
      FakeSocket.bossAutoSecurityReturn &&
      !FakeSocket.bossMissingLink &&
      request.params?.expression?.includes('link.click()')
    )
      queueMicrotask(() => {
        for (const url of [
          'https://www.zhipin.com/web/passport/zp/security.html',
          'https://www.zhipin.com/web/geek/jobs',
        ])
          this.dispatchEvent(
            new MessageEvent('message', {
              data: JSON.stringify({
                sessionId: 'attached',
                method: 'Page.frameNavigated',
                params: { frame: { url } },
              }),
            }),
          );
      });
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
      'Network.getResponseBody': {
        body: JSON.stringify(
          FakeSocket.responseBodies.get(String(request.params?.requestId)) ?? {
            code: 0,
            zpData: { hasMore: false, lid: 'fixture', jobList: [] },
          },
        ),
        base64Encoded: false,
      },
      'Runtime.evaluate': {
        result: {
          value: request.params?.expression?.includes('const jobs = any')
            ? 'ready'
            : request.params?.expression?.includes("window.dispatchEvent(new Event('scroll'))")
              ? true
              : request.params?.expression?.includes('next.click()')
                ? true
                : request.params?.expression?.includes('link.click()')
                  ? !FakeSocket.bossMissingLink
                  : request.params?.expression?.includes('window._PAGE')
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
          ...(FakeSocket.bossAuth
            ? [
                {
                  name: 'wt2',
                  value: 'account',
                  domain: '.zhipin.com',
                  path: '/',
                  secure: true,
                  expires: -1,
                },
                {
                  name: 'bst',
                  value: 'bst',
                  domain: '.zhipin.com',
                  path: '/',
                  secure: true,
                  expires: -1,
                },
                {
                  name: '__zp_stoken__',
                  value: FakeSocket.bossSecurity,
                  domain: '.zhipin.com',
                  path: '/',
                  secure: true,
                  expires: -1,
                },
              ]
            : []),
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
  FakeSocket.responseBodies.clear();
  FakeSocket.targetUrl = 'https://www.zhipin.com/web/geek/jobs';
  FakeSocket.extraTargets = [];
  FakeSocket.bossAuth = false;
  FakeSocket.bossSecurity = 'old';
  FakeSocket.bossAutoSecurityReturn = false;
  FakeSocket.bossMissingLink = false;
  vi.stubGlobal('WebSocket', FakeSocket);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('显式 HTTP 调试新建默认上下文专用页，使用自己的页且不刷新', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      Response.json({ code: 0, zpData: { hasMore: false, lid: 'fixture', jobList: [] } }),
    );
  vi.stubGlobal('fetch', fetcher);
  FakeSocket.extraTargets = [
    { targetId: 'other', type: 'page', url: 'https://example.com/?secret=never-expose' },
  ];
  const pending = new BossCdpSessionProvider().connect(
    { acquisitionMode: 'http' },
    new AbortController().signal,
  );
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
    {
      id: 1,
      method: 'Target.createTarget',
      params: { url: 'about:blank', newWindow: true, background: true },
    },
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

it.each([
  [true, false, false],
  [true, true, false],
  [true, false, true],
  [false, false, false],
] as const)(
  'BOSS HTTP 自有页=%s 官网自然返回=%s 链接缺失=%s 的受限恢复',
  async (owned, autoReturn, missingLink) => {
    FakeSocket.bossAuth = true;
    FakeSocket.bossAutoSecurityReturn = autoReturn;
    FakeSocket.bossMissingLink = missingLink;
    const fetcher = vi
      .fn<typeof fetch>()
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
      .mockResolvedValueOnce(Response.json({ code: 37 }))
      .mockResolvedValueOnce(
        Response.json({
          code: 0,
          zpData: {
            jobInfo: { encryptId: 'job1', jobName: '测试职位', postDescription: '测试正文' },
          },
        }),
      );
    vi.stubGlobal('fetch', fetcher);
    const pending = new BossCdpSessionProvider().connect(
      owned ? { acquisitionMode: 'http' } : { targetId: 'valid', acquisitionMode: 'http' },
      new AbortController().signal,
    );
    await vi.advanceTimersByTimeAsync(1);
    const session = await pending;
    const socket = FakeSocket.instances[0];
    if (!socket?.readyState) throw new Error('Missing socket');
    const signal = new AbortController().signal;
    try {
      // 1、列表和失败详情均为独立 HTTP；浏览器动作只允许自有页恢复。
      expect((await session.readNext(signal)).candidates).toHaveLength(1);
      await expect(session.readDetail('job1', signal)).rejects.toMatchObject({ businessCode: 37 });
      if (owned) {
        const resumed = session.resume?.(signal, { waitForChange: true });
        if (autoReturn) await vi.advanceTimersByTimeAsync(2_100);
        if (missingLink)
          await expect(resumed).rejects.toMatchObject({ reason: 'job_link_unavailable' });
        else await resumed;
        expect(
          socket.commands.filter((command) => command.params?.expression?.includes('link.click()')),
        ).toHaveLength(1);
        expect(fetcher).toHaveBeenCalledTimes(2);
        if (!missingLink) {
          expect((await session.readDetail('job1', signal)).description).toBe('测试正文');
          expect(fetcher).toHaveBeenCalledTimes(3);
        }
      } else {
        await expect(session.resume?.(signal)).rejects.toMatchObject({
          reason: 'context_unchanged',
        });
        expect(
          socket.commands.some((command) => command.params?.expression?.includes('link.click()')),
        ).toBe(false);
        expect(fetcher).toHaveBeenCalledTimes(2);
      }
      expect(socket.methods).not.toContain('Page.reload');
      expect(socket.methods).not.toContain('Page.bringToFront');
    } finally {
      session.disconnect();
    }
  },
);

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
  FakeSocket.failMethod = 'Page.enable';
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
  expect(
    socket.commands.find((command) => command.method === 'Target.createTarget')?.params,
  ).toEqual({ url: 'about:blank', newWindow: true, background: true });
  expect(socket.methods).not.toContain('Page.bringToFront');
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

it('前程无忧自建页续批只点击一次普通下一页，借用页不自动操作', async () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({
    jobId: String(100 + i),
    coId: '200',
    jobName: '开发工程师',
    companyName: '测试公司',
    jobAreaString: '上海',
    provideSalaryString: '面议',
    workYearString: '1年',
    degreeString: '本科',
    jobHref: `https://jobs.51job.com/shanghai/${String(100 + i)}.html`,
    jobDescribe: '完整职位描述。',
  }));
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json({ status: '1', resultbody: { job: { items: rows, totalCount: 21 } } }),
    )
    .mockResolvedValueOnce(
      Response.json({
        status: '1',
        resultbody: {
          job: {
            items: [
              { ...rows[0], jobId: '120', jobHref: 'https://jobs.51job.com/shanghai/120.html' },
            ],
            totalCount: 21,
          },
        },
      }),
    );
  vi.stubGlobal('fetch', fetcher);
  const pending = new Job51CdpSessionProvider().connect({}, new AbortController().signal);
  await vi.advanceTimersByTimeAsync(1);
  const session = await pending;
  const socket = FakeSocket.instances[0];
  if (!socket) throw new Error('Missing socket');
  const offer = (page: number): void => {
    const requestId = `page-${String(page)}`;
    const url = `https://we.51job.com/api/job/search-pc?api_key=51job&pageSize=20&pageNum=${String(page)}&decode__1048=fixture`;
    for (const [method, params] of [
      [
        'Network.requestWillBeSent',
        { requestId, request: { url, method: 'GET', headers: { accept: 'application/json' } } },
      ],
      ['Network.requestWillBeSentExtraInfo', { requestId, headers: { cookie: 'test-only' } }],
      ['Network.responseReceived', { requestId, response: { status: 200 } }],
    ] as const)
      socket.dispatchEvent(
        new MessageEvent('message', {
          data: JSON.stringify({ sessionId: 'attached', method, params }),
        }),
      );
  };
  offer(1);
  expect((await session.readNext(new AbortController().signal)).hasMore).toBe(true);
  const next = session.readNext(new AbortController().signal);
  await vi.advanceTimersByTimeAsync(1);
  const clicks = socket.commands.filter(
    (command) =>
      command.method === 'Runtime.evaluate' && command.params?.expression?.includes('next.click()'),
  );
  expect(clicks).toHaveLength(1);
  expect(clicks[0]?.params?.expression).toContain("active[0].textContent?.trim() !== '1'");
  expect(socket.methods).not.toContain('Page.bringToFront');
  expect(socket.methods).not.toContain('Page.reload');
  offer(2);
  await vi.advanceTimersByTimeAsync(100);
  expect((await next).hasMore).toBe(false);
  expect(fetcher).toHaveBeenCalledTimes(2);
  session.disconnect();
});

it('新页自然加载前只等待本地资源时间线，不重复导航', async () => {
  FakeSocket.emptyResourceReads = 3;
  const pending = new BossCdpSessionProvider().connect(
    { acquisitionMode: 'http' },
    new AbortController().signal,
  );
  await vi.advanceTimersByTimeAsync(3100);
  const session = await pending;
  const socket = FakeSocket.instances[0];
  expect(socket?.methods.filter((method) => method === 'Page.navigate')).toHaveLength(1);
  expect(socket?.commands.filter((command) => command.method === 'Runtime.evaluate')).toHaveLength(
    8,
  );
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
  const pending = connector
    .connect(
      provider === 'zhilian' ? { search: { keyword: '研发', city: '' } } : {},
      controller.signal,
    )
    .catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(1);
  const socket = FakeSocket.instances[0];
  if (!socket) throw new Error('Missing socket');
  expect(
    socket.commands.find((command) => command.method === 'Target.createTarget')?.params,
  ).toEqual({ url: 'about:blank', newWindow: true, background: true });
  expect(socket.methods).not.toContain('Page.bringToFront');
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

it.each([
  { owned: false, search: false },
  { owned: true, search: false },
  { owned: true, search: true },
])('猎聘初始化后通过 HTTP 获取，%j', async ({ owned, search }) => {
  FakeSocket.targetUrl = 'https://c.liepin.com/';
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
    Response.json(
      search
        ? {
            flag: 1,
            data: {
              data: { jobCardList: [] },
              pagination: { currentPage: 0, pageSize: 40, totalPage: 0, hasNext: false },
              passThroughData: { scene: 'input', skId: '', fkId: '', ckId: 'fixture' },
            },
          }
        : { flag: 1, data: { data: [], addData: [], hasNextPage: false } },
    ),
  );
  vi.stubGlobal('fetch', fetcher);
  const pending = new LiepinCdpSessionProvider().connect(
    search
      ? { search: { keyword: '算法工程师', city: '' } }
      : owned
        ? {}
        : { portFile: '/fixture/DevToolsActivePort', targetId: 'valid' },
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
        url: search
          ? 'https://api-c.liepin.com/api/com.liepin.searchfront4c.pc-search-job'
          : 'https://api-c.liepin.com/api/com.liepin.csearch.home-recommend-job-new',
        headers: { Accept: 'application/json', Cookie: 'do-not-reuse' },
        postData: JSON.stringify(
          search
            ? {
                data: {
                  mainSearchPcConditionForm: { key: '算法工程师', currentPage: 0, pageSize: 40 },
                  passThroughForm: { scene: 'input', skId: '', fkId: '', ckId: 'fixture' },
                },
              }
            : {
                data: {
                  operateKind: 'LOGIN',
                  sortType: 'PC_STU_HP_NEW',
                  selectedExpect: '{}',
                  existFallbackResult: false,
                },
              },
        ),
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
  if (search)
    expect(socket.ownedUrl).toBe(
      'https://www.liepin.com/zhaopin/?key=' + encodeURIComponent('算法工程师'),
    );
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

it.each([
  { backgroundWindow: undefined, search: false },
  { backgroundWindow: false, search: false },
  { backgroundWindow: true, search: false },
  { backgroundWindow: true, search: true },
])('BOSS browser 新页观察真实列表，%j', async ({ backgroundWindow, search }) => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  const pending = new BossCdpSessionProvider(
    backgroundWindow === undefined ? {} : { backgroundWindow },
  ).connect(
    search ? { search: { keyword: '算法工程师', city: '' } } : {},
    new AbortController().signal,
  );
  await vi.advanceTimersByTimeAsync(1);
  const session = await pending;
  const socket = FakeSocket.instances[0];
  if (!socket) throw new Error('Missing socket');
  expect(socket.commands.find((command) => command.method === 'Target.createTarget')).toMatchObject(
    {
      params: {
        url: 'about:blank',
        ...(backgroundWindow !== false ? { newWindow: true, background: true } : {}),
      },
    },
  );
  const url = search
    ? 'https://www.zhipin.com/wapi/zpgeek/search/joblist.json?_=123'
    : 'https://www.zhipin.com/wapi/zpgeek/pc/recommend/job/list.json?page=1';
  const entryUrl =
    'https://www.zhipin.com/web/geek/jobs' +
    (search ? '?query=' + encodeURIComponent('算法工程师') : '');
  expect(socket.ownedUrl).toBe(entryUrl);
  // 1、专用页的首次导航和列表响应均经过生产观察器，不使用历史模板替代。
  for (const [method, params] of [
    ['Page.frameNavigated', { frame: { url: entryUrl } }],
    [
      'Network.requestWillBeSent',
      {
        requestId: 'list',
        request: {
          url,
          method: search ? 'POST' : 'GET',
          ...(search
            ? {
                postData: new URLSearchParams({
                  page: '1',
                  pageSize: '15',
                  query: '算法工程师',
                }).toString(),
              }
            : {}),
        },
      },
    ],
    ['Network.responseReceived', { requestId: 'list', response: { url, status: 200 } }],
    ['Network.loadingFinished', { requestId: 'list', encodedDataLength: 100 }],
  ])
    socket.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify({ sessionId: 'attached', method, params }),
      }),
    );
  await vi.advanceTimersByTimeAsync(1);
  const firstBatch = session.readNext(new AbortController().signal);
  await vi.advanceTimersByTimeAsync(1100);
  await expect(firstBatch).resolves.toMatchObject({ candidates: [], hasMore: false });
  expect(socket.methods.indexOf('Network.enable')).toBeLessThan(
    socket.methods.indexOf('Page.navigate'),
  );
  expect(socket.methods.filter((method) => method === 'Page.navigate')).toHaveLength(1);
  expect(socket.methods).not.toContain('Network.getCookies');
  expect(socket.methods).not.toContain('Page.reload');
  expect(fetcher).not.toHaveBeenCalled();
  expect('resume' in session).toBe(false);
  session.disconnect();
  await vi.advanceTimersByTimeAsync(1);
});

it('BOSS 后台下一批只派发一次普通滚动事件，不刷新或激活页面', async () => {
  const pending = new BossCdpSessionProvider().connect({}, new AbortController().signal);
  await vi.advanceTimersByTimeAsync(1);
  const session = await pending;
  const socket = FakeSocket.instances[0];
  if (!socket) throw new Error('Missing socket');
  const emit = (method: string, params: unknown): void => {
    socket.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify({ sessionId: 'attached', method, params }),
      }),
    );
  };
  const emitResponse = (requestId: string, url: string, body: unknown): void => {
    FakeSocket.responseBodies.set(requestId, body);
    emit('Network.requestWillBeSent', { requestId, request: { url, method: 'GET' } });
    emit('Network.responseReceived', { requestId, response: { url, status: 200 } });
    emit('Network.loadingFinished', { requestId, encodedDataLength: 100 });
  };
  // 1、首批与详情均由所选页的真实响应事件交付，不模拟额外 HTTP。
  emit('Page.frameNavigated', { frame: { url: 'https://www.zhipin.com/web/geek/jobs' } });
  emitResponse('list1', 'https://www.zhipin.com/wapi/zpgeek/pc/recommend/job/list.json?page=1', {
    code: 0,
    zpData: {
      hasMore: true,
      lid: 'fixture',
      jobList: [
        {
          encryptJobId: 'job1',
          encryptBrandId: 'brand1',
          securityId: 'security1',
          jobName: '测试职位',
          brandName: '测试公司',
          cityName: '上海',
          salaryDesc: '',
          jobExperience: '',
          jobDegree: '',
        },
      ],
    },
  });
  const first = session.readNext(new AbortController().signal);
  await vi.advanceTimersByTimeAsync(1100);
  await expect(first).resolves.toMatchObject({ candidates: [{ externalJobId: 'job1' }] });
  const detail = session.readDetail('job1', new AbortController().signal);
  await vi.advanceTimersByTimeAsync(1);
  emitResponse(
    'detail1',
    'https://www.zhipin.com/wapi/zpgeek/job/detail.json?securityId=security1',
    {
      code: 0,
      zpData: { jobInfo: { encryptId: 'job1', jobName: '测试职位', postDescription: '测试正文' } },
    },
  );
  await expect(detail).resolves.toMatchObject({ externalJobId: 'job1' });
  // 2、后台下一批只运行一次三段普通滚动；没有响应时取消等待，不补发第二次动作。
  const controller = new AbortController();
  const next = session.readNext(controller.signal).catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(1);
  const actions = socket.commands.filter(
    (command) =>
      command.method === 'Runtime.evaluate' &&
      command.params?.expression?.includes("window.dispatchEvent(new Event('scroll'))"),
  );
  expect(actions).toHaveLength(1);
  expect(actions[0]?.params?.expression).toContain('window.scrollTo(0, 0)');
  expect(actions[0]?.params?.expression).toContain(
    'window.scrollTo(0, document.body.scrollHeight)',
  );
  expect(actions[0]?.params?.expression).toContain('/job_detail/job1.html');
  expect(socket.methods).not.toContain('Page.bringToFront');
  expect(socket.methods).not.toContain('Page.reload');
  controller.abort();
  await next;
  session.disconnect();
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

it.each([new BossCdpSessionProvider()])(
  '未验证搜索协议的平台在连接前拒绝关键词，不能回退推荐流',
  async (provider) => {
    await expect(
      provider.connect(
        { search: { keyword: '算法工程师', city: '' }, acquisitionMode: 'http' },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ reason: 'search_unsupported' });
    expect(FakeSocket.instances).toHaveLength(0);
  },
);

it('前程无忧资料搜索在专用页打开指定关键词', async () => {
  const pending = new Job51CdpSessionProvider().connect(
    { search: { keyword: '算法工程师', city: '' } },
    new AbortController().signal,
  );
  await vi.advanceTimersByTimeAsync(1);
  const session = await pending;
  expect(FakeSocket.instances[0]?.ownedUrl).toBe(
    'https://we.51job.com/pc/search?keyword=%E7%AE%97%E6%B3%95%E5%B7%A5%E7%A8%8B%E5%B8%88',
  );
  session.disconnect();
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
    { portFile: '/profile/DevToolsActivePort', targetId: 'valid', acquisitionMode: 'http' },
    signal,
  );
  await vi.advanceTimersByTimeAsync(FakeSocket.openDelay + 1);
  return pending;
}

it('reports an expired initialization session without an unhandled rejection or socket leak', async () => {
  // 1、模拟初始化读取完成后标签失效，不连接真实浏览器。
  FakeSocket.failMethod = 'Network.getCookies';
  const pending = new BossCdpSessionProvider().connect(
    { portFile: '/profile/DevToolsActivePort', targetId: 'valid', acquisitionMode: 'http' },
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
  expect(methods.at(-1)).toBe('Network.getCookies');
  await vi.advanceTimersByTimeAsync(130_000);
  expect(socket.readyState).toBe(1);
  const sync = [
    'Runtime.evaluate',
    'Target.getTargets',
    'Target.attachToTarget',
    'Runtime.evaluate',
    'Network.getCookies',
    'Target.detachFromTarget',
  ];
  expect(socket.methods).toEqual([...methods, ...sync, ...sync]);
  expect(socket.methods.filter((method) => method === 'Page.enable')).toHaveLength(1);
  expect(FakeSocket.instances).toHaveLength(1);
  session.disconnect();
  expect(socket.readyState).toBe(3);
});

it.each(['before', 'inflight'] as const)(
  'HTTP %s 导航使上下文失效，不交付迟到列表',
  async (when) => {
    let deliver!: (value: Response) => void;
    const fetcher = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          deliver = resolve;
        }),
    );
    vi.stubGlobal('fetch', fetcher);
    const session = await connected();
    const socket = FakeSocket.instances[0];
    if (!socket) throw new Error('Missing socket');
    const navigate = (): void => {
      socket.dispatchEvent(
        new MessageEvent('message', {
          data: JSON.stringify({
            sessionId: 'attached',
            method: 'Page.frameNavigated',
            params: { frame: { url: 'https://www.zhipin.com/web/geek/jobs' } },
          }),
        }),
      );
    };
    if (when === 'before') navigate();
    const assertion = expect(session.readNext(new AbortController().signal)).rejects.toMatchObject({
      reason: 'page_navigated',
    });
    if (when === 'inflight') {
      await vi.advanceTimersByTimeAsync(1);
      expect(fetcher).toHaveBeenCalledTimes(1);
      navigate();
      deliver(Response.json({ code: 0, zpData: { hasMore: false, lid: 'fixture', jobList: [] } }));
    }
    await assertion;
    expect(fetcher).toHaveBeenCalledTimes(when === 'before' ? 0 : 1);
    expect(socket.methods).not.toContain('Network.enable');
    expect(socket.methods).not.toContain('Network.getResponseBody');
    expect(socket.readyState).toBe(1);
    session.disconnect();
  },
);

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

it('智联自动连接只打开首页，以同一次认证请求初始化 HTTP，缺少查询不启动浏览器', async () => {
  const connector = new ZhilianCdpSessionProvider();
  const signal = new AbortController().signal;
  await expect(connector.connect({}, signal)).rejects.toMatchObject({ reason: 'query_required' });
  expect(FakeSocket.instances).toHaveLength(0);
  const pending = connector.connect({ search: { keyword: '研发', city: '' } }, signal);
  await vi.advanceTimersByTimeAsync(1);
  const request = {
    method: 'POST',
    url: 'https://fe-api.zhaopin.com/c/i/resume/preview-standardnode?at=test-at&rt=test-rt&platform=13&version=0.0.0',
    headers: {},
    postData: JSON.stringify({
      at: 'test-at',
      rt: 'test-rt',
      resumeNumber: 'test-resume',
      platform: 13,
      version: '0.0.0',
    }),
  };
  emitCampus(request, 'foreign');
  await vi.advanceTimersByTimeAsync(1);
  expect(FakeSocket.instances[0]?.methods).not.toContain('Network.disable');
  emitCampus(request);
  const session = await pending;
  const socket = FakeSocket.instances[0];
  expect(
    socket?.commands
      .filter((command) => command.method === 'Page.navigate')
      .map((command) => command.params?.url),
  ).toEqual(['https://www.zhaopin.com/jobs']);
  expect(socket?.methods).not.toContain('Network.getResponseBody');
  expect(socket?.methods).not.toContain('Network.getCookies');
  expect(socket?.methods).not.toContain('Runtime.evaluate');
  expect(socket?.methods.slice(-2)).toEqual(['Network.disable', 'Target.detachFromTarget']);
  session.disconnect();
  await vi.advanceTimersByTimeAsync(1);
});

it.each(['list-first', 'detail-first'] as const)(
  'initializes explicit main-site %s templates on one authorized socket',
  async (order) => {
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
      { portFile: '/profile/DevToolsActivePort', targetId: 'valid' },
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
    expect(FakeSocket.instances[0]?.methods.at(-1)).toBe('Network.enable');
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
