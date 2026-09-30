import { afterEach, expect, it, vi, type Mock } from 'vitest';
import { BossBrowserSession } from '../src/boss-browser.js';
import type { BossPageState } from '../src/boss-page-state.js';

const listUrl = 'https://www.zhipin.com/wapi/zpgeek/pc/recommend/job/list.json?page=1&city=1';
const detailUrl = 'https://www.zhipin.com/wapi/zpgeek/job/detail.json?securityId=private-a';
const row = {
  encryptJobId: 'a',
  encryptBrandId: 'c',
  securityId: 'private-a',
  jobName: '测试职位',
  brandName: '测试公司',
  cityName: '深圳',
  salaryDesc: '面议',
  jobExperience: '不限',
  jobDegree: '本科',
};
const list = { code: 0, zpData: { hasMore: false, lid: 'test', jobList: [row] } };
const detail = {
  code: 0,
  zpData: { jobInfo: { encryptId: 'a', jobName: '测试职位', postDescription: '负责开发与维护。' } },
};
const signal = (): AbortSignal => new AbortController().signal;

it('专用页首次预期导航允许采集，第二次主框架导航冻结旧批次', async () => {
  const url = 'https://www.zhipin.com/web/geek/jobs';
  const f = fixture(detail, url);
  f.event('Page.frameNavigated', { frame: { url } });
  await f.emit(listUrl, list);
  await expect(f.session.readNext(signal())).resolves.toMatchObject({
    candidates: [{ externalJobId: 'a' }],
  });
  f.event('Page.frameNavigated', { frame: { url } });
  await expect(f.session.readDetail('a', signal())).rejects.toMatchObject({
    category: 'session_unavailable',
  });
  expect(f.clickJob).not.toHaveBeenCalled();
  f.session.disconnect();
});

it('专用页首次跳往非预期页面仍冻结，不操作登录或验证', async () => {
  const f = fixture(detail, 'https://www.zhipin.com/web/geek/jobs');
  f.event('Page.frameNavigated', { frame: { url: 'https://example.com/login' } });
  await expect(f.session.readNext(signal())).rejects.toMatchObject({
    category: 'session_unavailable',
  });
  expect(f.clickJob).not.toHaveBeenCalled();
});

/** 合成所选页面网络事件，不连接真实站点；仅正文读取可调用 CDP。 */
function fixture(
  detailBody: unknown = detail,
  initialNavigationUrl?: string,
  inspectPage?: (signal: AbortSignal) => Promise<BossPageState>,
  loadNext?: (lastJobId: string, signal: AbortSignal) => Promise<void>,
  activateForNext = true,
  searchKeyword?: string,
): {
  session: BossBrowserSession;
  emit: (
    url: string,
    body: unknown,
    status?: number,
    sessionId?: string,
    postData?: string,
  ) => Promise<void>;
  event: (method: string, params: unknown, sessionId?: string) => void;
  call: Mock<
    (
      method: string,
      params: Record<string, unknown>,
    ) => Promise<{ body: string; base64Encoded: boolean }>
  >;
  clickJob: Mock<() => Promise<void>>;
} {
  const bodies = new Map<string, unknown>();
  let ordinal = 0;
  const call = vi.fn((_method: string, params: Record<string, unknown>) =>
    Promise.resolve({
      body: JSON.stringify(bodies.get(String(params.requestId))),
      base64Encoded: false,
    }),
  );
  const clickJob = vi.fn(async () => {
    await emit(detailUrl, detailBody);
  });
  const session = new BossBrowserSession({
    sessionId: 'selected',
    call,
    clickJob,
    ...(initialNavigationUrl ? { initialNavigationUrl } : {}),
    ...(inspectPage ? { inspectPage } : {}),
    ...(loadNext ? { loadNext } : {}),
    activateForNext,
    ...(searchKeyword ? { searchKeyword } : {}),
  });
  const event = (method: string, params: unknown, sessionId = 'selected'): void => {
    session.accept({ sessionId, method, params });
  };
  /** 完整生命周期先观察请求，再收到响应，最后才允许取正文。 */
  async function emit(
    url: string,
    body: unknown,
    status = 200,
    sessionId = 'selected',
    postData?: string,
  ): Promise<void> {
    const requestId = String(++ordinal);
    bodies.set(requestId, body);
    event(
      'Network.requestWillBeSent',
      {
        requestId,
        request: { url, method: postData ? 'POST' : 'GET', ...(postData ? { postData } : {}) },
      },
      sessionId,
    );
    event('Network.responseReceived', { requestId, response: { url, status } }, sessionId);
    event('Network.loadingFinished', { requestId, encodedDataLength: 100 }, sessionId);
    await Promise.resolve();
    await Promise.resolve();
  }
  return { session, emit, event, call, clickJob };
}

it('搜索只消费匹配关键词的真实 POST JSON，详情仍走正常点击', async () => {
  const f = fixture(detail, undefined, undefined, undefined, false, 'AI应用开发');
  await f.emit(
    'https://www.zhipin.com/wapi/zpgeek/search/joblist.json?_=123',
    list,
    200,
    'selected',
    'page=1&pageSize=15&query=AI应用开发&city=101280600&scene=1',
  );
  expect(await f.session.readNext(signal())).toMatchObject({
    candidates: [{ externalJobId: 'a' }],
  });
  expect(await f.session.readDetail('a', signal())).toMatchObject({
    description: '负责开发与维护。',
  });
  expect(f.clickJob).toHaveBeenCalledOnce();
  f.session.disconnect();
});

it('关键词错配不能消费另一个搜索结果', async () => {
  const f = fixture(detail, undefined, undefined, undefined, false, 'AI应用开发');
  await f.emit(
    'https://www.zhipin.com/wapi/zpgeek/search/joblist.json?_=123',
    list,
    200,
    'selected',
    'page=1&query=Java',
  );
  await expect(f.session.readNext(signal())).rejects.toMatchObject({ reason: 'query_changed' });
  expect(f.clickJob).not.toHaveBeenCalled();
});

it('跨词去重释放当前候选后允许下一批，不额外点击重复详情', async () => {
  const next = vi.fn(async () => {
    await f.emit(listUrl.replace('page=1', 'page=2'), {
      code: 0,
      zpData: { hasMore: false, lid: 'test', jobList: [{ ...row, encryptJobId: 'b' }] },
    });
  });
  const f = fixture(detail, undefined, undefined, next, false);
  await f.emit(listUrl, { ...list, zpData: { ...list.zpData, hasMore: true } });
  await f.session.readNext(signal());
  f.session.discardDetail('a');
  await expect(f.session.readNext(signal())).resolves.toMatchObject({
    candidates: [{ externalJobId: 'b' }],
  });
  expect(f.clickJob).not.toHaveBeenCalled();
  f.session.disconnect();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each([true, false])('用户再次获取只加载一次下一批，激活策略=%s', async (activateForNext) => {
  // 1、下一批只在显式 readNext 时由官网模拟返回，禁止后台循环加载。
  const loadNext = vi.fn(async () => {
    await f.emit(listUrl.replace('page=1', 'page=2'), {
      code: 0,
      zpData: {
        hasMore: false,
        lid: 'test',
        jobList: [{ ...row, encryptJobId: 'b', securityId: 'private-b' }],
      },
    });
  });
  const f = fixture(detail, undefined, undefined, loadNext, activateForNext);
  await f.emit(listUrl, { ...list, zpData: { ...list.zpData, hasMore: true } });
  await f.session.readNext(signal());
  expect(loadNext).not.toHaveBeenCalled();
  await f.session.readDetail('a', signal());
  // 2、校验真实页序，不因滚动成功就认定采集成功。
  await expect(f.session.readNext(signal())).resolves.toMatchObject({
    candidates: [{ externalJobId: 'b' }],
    hasMore: false,
  });
  expect(loadNext).toHaveBeenCalledOnce();
  expect(f.call.mock.calls.some(([method]) => method === 'Page.bringToFront')).toBe(
    activateForNext,
  );
  expect(loadNext).toHaveBeenCalledWith('a', expect.any(AbortSignal));
  f.session.disconnect();
});

it('列表响应后立即串行点击详情，不等待固定五秒', async () => {
  // 1、固定时钟，任何残留的五秒门槛都会阻止本测试完成。
  vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
  const f = fixture();
  await f.emit(listUrl, list);
  await f.session.readNext(signal());
  // 2、使用合成官网响应验证点击与正文解析，不连接真实平台。
  await expect(f.session.readDetail('a', signal())).resolves.toMatchObject({
    externalJobId: 'a',
    description: '负责开发与维护。',
  });
  expect(f.clickJob).toHaveBeenCalledOnce();
  f.session.disconnect();
});

it('激活期间到达的下一批直接消费，不再次滚动', async () => {
  const loadNext = vi.fn();
  const f = fixture(detail, undefined, undefined, loadNext);
  await f.emit(listUrl, { ...list, zpData: { ...list.zpData, hasMore: true } });
  await f.session.readNext(signal());
  await f.session.readDetail('a', signal());
  // 1、模拟激活页唤醒原在后台延迟的官网列表，正文仍走原观察通道。
  f.call.mockImplementationOnce(async (method) => {
    expect(method).toBe('Page.bringToFront');
    await f.emit(listUrl.replace('page=1', 'page=2'), {
      code: 0,
      zpData: {
        hasMore: false,
        lid: 'test',
        jobList: [{ ...row, encryptJobId: 'b', securityId: 'private-b' }],
      },
    });
    return { body: '{}', base64Encoded: false };
  });
  // 2、已有数据不得再触发额外一批。
  await expect(f.session.readNext(signal())).resolves.toMatchObject({
    candidates: [{ externalJobId: 'b' }],
  });
  expect(loadNext).not.toHaveBeenCalled();
  f.session.disconnect();
});

/** 将截止计时器一起纳入虚拟时钟，测试不等待真实一分钟。 */
function fakeClock(): void {
  vi.useFakeTimers();
  vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
    const controller = new AbortController();
    setTimeout(() => {
      controller.abort();
    }, ms);
    return controller.signal;
  });
}

it('初始化正常同源跳转后页面恢复，保留观察并消费新文档列表', async () => {
  fakeClock();
  const inspect = vi
    .fn<() => Promise<BossPageState>>()
    .mockResolvedValueOnce('loading')
    .mockResolvedValue('ready');
  const f = fixture(detail, 'https://www.zhipin.com/web/geek/jobs', inspect);
  const batch = f.session.readNext(signal());
  f.event('Page.frameNavigated', { frame: { url: 'https://www.zhipin.com/web/geek/jobs' } });
  await f.emit(listUrl, list);
  f.event('Page.frameNavigated', {
    frame: { url: 'https://www.zhipin.com/web/geek/jobs?_security_check=synthetic' },
  });
  await f.emit(listUrl, list);
  await vi.advanceTimersByTimeAsync(1100);
  await expect(batch).resolves.toMatchObject({ candidates: [{ externalJobId: 'a' }] });
  expect(f.clickJob).not.toHaveBeenCalled();
  f.session.disconnect();
});

it.each(['login_required', 'verification_required', 'access_blocked', 'rate_limited'] as const)(
  '连续两次确认 %s 才停止且不点击职位',
  async (state) => {
    fakeClock();
    const inspect = vi.fn(() => Promise.resolve(state));
    const f = fixture(detail, undefined, inspect);
    const assertion = expect(f.session.readNext(signal())).rejects.toMatchObject({ reason: state });
    await vi.advanceTimersByTimeAsync(1100);
    await assertion;
    expect(inspect).toHaveBeenCalledTimes(2);
    expect(f.clickJob).not.toHaveBeenCalled();
  },
);

it.each(['loading', 'ready'] as const)(
  '首批等待 %s 到期有明确诊断，不发职位探测',
  async (state) => {
    fakeClock();
    const f = fixture(detail, undefined, () => Promise.resolve(state));
    const assertion = expect(f.session.readNext(signal())).rejects.toMatchObject({
      reason: state === 'ready' ? 'list_response_timeout' : 'page_not_ready',
    });
    await vi.advanceTimersByTimeAsync(60001);
    await assertion;
    expect(f.call).not.toHaveBeenCalled();
    expect(f.clickJob).not.toHaveBeenCalled();
  },
);

it('旧文档正文迟到不能污染新页或冻结新观察', async () => {
  fakeClock();
  const f = fixture(detail, 'https://www.zhipin.com/web/geek/jobs');
  let complete!: (value: { body: string; base64Encoded: boolean }) => void;
  f.call.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  await f.emit(listUrl, list);
  f.event('Page.frameNavigated', {
    frame: { url: 'https://www.zhipin.com/web/geek/jobs?_security_check=synthetic' },
  });
  await f.emit(listUrl, list);
  complete({ body: JSON.stringify({ code: 37 }), base64Encoded: false });
  await vi.advanceTimersByTimeAsync(1100);
  await expect(f.session.readNext(signal())).resolves.toMatchObject({
    candidates: [{ externalJobId: 'a' }],
  });
  f.session.disconnect();
});

it('观察列表和正常详情，复用校验且不发独立 HTTP，不读取 Cookie', async () => {
  let now = Date.now();
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  const f = fixture();
  await f.emit(listUrl, list);
  const batch = await f.session.readNext(signal());
  expect(batch.candidates).toHaveLength(1);
  now += 6000;
  expect((await f.session.readDetail('a', signal())).description).toBe('负责开发与维护。');
  expect(f.clickJob).toHaveBeenCalledTimes(1);
  expect(f.call.mock.calls.every(([method]) => method === 'Network.getResponseBody')).toBe(true);
  expect(fetcher).not.toHaveBeenCalled();
  expect(await f.session.readNext(signal())).toEqual({ candidates: [], hasMore: false });
  f.session.disconnect();
});

it.each([37, 7])('详情业务码 %s 冻结整批，不自动换 HTTP 或再次点击', async (code) => {
  let now = Date.now();
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const f = fixture({ code });
  await f.emit(listUrl, list);
  await f.session.readNext(signal());
  now += 6000;
  await expect(f.session.readDetail('a', signal())).rejects.toMatchObject({ businessCode: code });
  await expect(f.session.readDetail('a', signal())).rejects.toMatchObject({ businessCode: code });
  expect(f.clickJob).toHaveBeenCalledTimes(1);
});

it('同轮官网自动打开首条时复用实际 JSON，不再次点击已选职位', async () => {
  let now = Date.now();
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const f = fixture();
  await f.emit(listUrl, list);
  await f.emit(detailUrl, detail);
  await f.session.readNext(signal());
  now += 6000;
  expect((await f.session.readDetail('a', signal())).externalJobId).toBe('a');
  expect(f.clickJob).not.toHaveBeenCalled();
  expect(f.call).toHaveBeenCalledTimes(2);
  f.session.disconnect();
});

it('正常下一页必须延续相同查询且页码连续', async () => {
  let now = Date.now();
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const f = fixture();
  await f.emit(listUrl, { code: 0, zpData: { ...list.zpData, hasMore: true } });
  await f.session.readNext(signal());
  now += 6000;
  await f.session.readDetail('a', signal());
  now += 6000;
  await f.emit(listUrl.replace('page=1', 'page=2'), {
    code: 0,
    zpData: { ...list.zpData, jobList: [{ ...row, encryptJobId: 'b', securityId: 'private-b' }] },
  });
  expect((await f.session.readNext(signal())).candidates[0]?.externalJobId).toBe('b');
  f.session.disconnect();
});

it('明细等待中取消不会继续点击或接受迟到正文', async () => {
  let now = Date.now();
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const f = fixture();
  const controller = new AbortController();
  f.clickJob.mockImplementation(() => {
    controller.abort();
    return Promise.resolve();
  });
  await f.emit(listUrl, list);
  await f.session.readNext(signal());
  now += 6000;
  await expect(f.session.readDetail('a', controller.signal)).rejects.toMatchObject({
    category: 'session_unavailable',
  });
  await f.emit(detailUrl, detail);
  await expect(f.session.readDetail('a', signal())).rejects.toMatchObject({
    category: 'session_unavailable',
  });
  expect(f.clickJob).toHaveBeenCalledTimes(1);
  expect(f.call).toHaveBeenCalledTimes(1);
});

it.each(['wrong-job', 'empty-body'])('详情 %s 不得入库', async (kind) => {
  let now = Date.now();
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const f = fixture({
    code: 0,
    zpData: {
      jobInfo: {
        ...detail.zpData.jobInfo,
        ...(kind === 'wrong-job' ? { encryptId: 'b' } : { postDescription: '' }),
      },
    },
  });
  await f.emit(listUrl, list);
  await f.session.readNext(signal());
  now += 6000;
  await expect(f.session.readDetail('a', signal())).rejects.toMatchObject({
    category: 'parse_changed',
  });
});

it('忽略其他标签页，首次跳页和过期响应拒绝消费', async () => {
  const f = fixture();
  await f.emit(listUrl, list, 200, 'other');
  expect(f.call).not.toHaveBeenCalled();
  await f.emit(listUrl.replace('page=1', 'page=2'), list);
  await expect(f.session.readNext(signal())).rejects.toMatchObject({ category: 'parse_changed' });
  const g = fixture();
  await g.emit(listUrl, list);
  const later = Date.now() + 121_000;
  vi.spyOn(Date, 'now').mockReturnValue(later);
  await expect(g.session.readNext(signal())).rejects.toMatchObject({ category: 'parse_changed' });
});

it('当前批次未完成时外部新列表使会话失效，不混合查询', async () => {
  const f = fixture();
  await f.emit(listUrl, list);
  await f.session.readNext(signal());
  await f.emit(listUrl.replace('city=1', 'city=2'), list);
  await expect(f.session.readDetail('a', signal())).rejects.toMatchObject({
    category: 'session_unavailable',
  });
  expect(f.clickJob).not.toHaveBeenCalled();
});

it('取消和主页面导航立即停止，不执行后续点击', async () => {
  const f = fixture();
  const controller = new AbortController();
  controller.abort();
  await expect(f.session.readNext(controller.signal)).rejects.toMatchObject({
    category: 'session_unavailable',
  });
  const g = fixture();
  await g.emit(listUrl, list);
  await g.session.readNext(signal());
  g.event('Page.frameNavigated', { frame: { id: 'main' } });
  await expect(g.session.readDetail('a', signal())).rejects.toMatchObject({
    category: 'session_unavailable',
  });
  expect(g.clickJob).not.toHaveBeenCalled();
});

it('正文获取失败、超大响应和 HTTP 限流保持脱敏分类', async () => {
  const f = fixture();
  f.call.mockRejectedValueOnce(new Error('secret-url'));
  await f.emit(listUrl, list);
  await expect(f.session.readNext(signal())).rejects.toMatchObject({
    reason: 'response_body_unavailable',
  });
  const g = fixture();
  await g.emit(listUrl, list, 429);
  await expect(g.session.readNext(signal())).rejects.toMatchObject({ category: 'rate_limited' });
  const h = fixture();
  h.call.mockResolvedValueOnce({ body: 'x'.repeat(2 * 1024 * 1024 + 1), base64Encoded: false });
  await h.emit(listUrl, list);
  await expect(h.session.readNext(signal())).rejects.toMatchObject({ category: 'parse_changed' });
});
