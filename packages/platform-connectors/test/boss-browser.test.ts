import { afterEach, expect, it, vi, type Mock } from 'vitest';
import { BossBrowserSession } from '../src/boss-browser.js';

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

/** 合成所选页面网络事件，不连接真实站点；仅正文读取可调用 CDP。 */
function fixture(detailBody: unknown = detail): {
  session: BossBrowserSession;
  emit: (url: string, body: unknown, status?: number, sessionId?: string) => Promise<void>;
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
  const session = new BossBrowserSession({ sessionId: 'selected', call, clickJob });
  const event = (method: string, params: unknown, sessionId = 'selected'): void => {
    session.accept({ sessionId, method, params });
  };
  /** 完整生命周期先观察请求，再收到响应，最后才允许取正文。 */
  async function emit(
    url: string,
    body: unknown,
    status = 200,
    sessionId = 'selected',
  ): Promise<void> {
    const requestId = String(++ordinal);
    bodies.set(requestId, body);
    event('Network.requestWillBeSent', { requestId, request: { url, method: 'GET' } }, sessionId);
    event('Network.responseReceived', { requestId, response: { url, status } }, sessionId);
    event('Network.loadingFinished', { requestId, encodedDataLength: 100 }, sessionId);
    await Promise.resolve();
    await Promise.resolve();
  }
  return { session, emit, event, call, clickJob };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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
  await expect(f.session.readNext(signal())).rejects.toThrow('parse_changed');
  const g = fixture();
  await g.emit(listUrl, list, 429);
  await expect(g.session.readNext(signal())).rejects.toMatchObject({ category: 'rate_limited' });
  const h = fixture();
  h.call.mockResolvedValueOnce({ body: 'x'.repeat(2 * 1024 * 1024 + 1), base64Encoded: false });
  await h.emit(listUrl, list);
  await expect(h.session.readNext(signal())).rejects.toMatchObject({ category: 'parse_changed' });
});
