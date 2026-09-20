import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  BossCdpSessionProvider,
  ZhilianCdpSessionProvider,
  Job51CdpSessionProvider,
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
  static targetUrl = 'https://www.zhipin.com/web/geek/jobs';
  readyState = 0;
  methods: string[] = [];
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
    const request = JSON.parse(data) as { id: number; method: string };
    this.methods.push(request.method);
    if (FakeSocket.silent) return;
    const responses: Record<string, unknown> = {
      'Target.getTargets': {
        targetInfos: [{ targetId: 'valid', type: 'page', url: FakeSocket.targetUrl }],
      },
      'Target.attachToTarget': { sessionId: 'attached' },
      'Runtime.evaluate': {
        result: {
          value: JSON.stringify([
            'https://www.zhipin.com/wapi/zpgeek/pc/recommend/job/list.json?page=1',
          ]),
        },
      },
      'Network.getCookies': {
        cookies: [
          {
            name: 'session',
            value: 'test-only',
            domain: '.zhipin.com',
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
  FakeSocket.targetUrl = 'https://www.zhipin.com/web/geek/jobs';
  vi.stubGlobal('WebSocket', FakeSocket);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
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
  // 1、连接任务完成后，新的列表／详情任务复用同一连接，不新增 CDP 命令。
  expect((await session.readNext(new AbortController().signal)).candidates).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(5_000);
  expect((await session.readDetail('job1', new AbortController().signal)).description).toBe(
    '测试正文',
  );
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(socket.readyState).toBe(1);
  expect(methods.at(-1)).toBe('Target.detachFromTarget');
  await vi.advanceTimersByTimeAsync(130_000);
  expect(socket.readyState).toBe(1);
  expect(socket.methods).toEqual(methods);
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

it.each(['list-first', 'detail-first'] as const)(
  'initializes main-site %s templates on one authorized socket',
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
