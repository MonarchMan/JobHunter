import { describe, expect, it, vi } from 'vitest';
import * as timers from 'node:timers/promises';
import { BossHttpSession, cookieHeaderForUrl, type BrowserCookie } from '../src/index.js';

vi.mock('node:timers/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof timers>();
  return { ...actual, setTimeout: vi.fn(actual.setTimeout) };
});

const cookie: BrowserCookie = {
  name: 'session',
  value: 'test-secret',
  domain: '.zhipin.com',
  path: '/',
  secure: true,
  expires: -1,
};
const observedListUrl =
  'https://www.zhipin.com/wapi/zpgeek/pc/recommend/job/list.json?page=1&city=101280600';
/** 合成职位卡片，不包含任何真实账号数据。 */
const row = (id: string): Record<string, string> => ({
  encryptJobId: id,
  encryptBrandId: 'company-1',
  securityId: `private-${id}`,
  lid: 'item-lid',
  jobName: '测试职位',
  brandName: '测试公司',
  cityName: '深圳',
  salaryDesc: '10-20K',
  jobExperience: '经验不限',
  jobDegree: '本科',
});
/** 合成列表封装。 */
const page = (ids: string[], hasMore = true): unknown => ({
  code: 0,
  zpData: { hasMore, lid: 'root-lid', jobList: ids.map(row) },
});
/** 合成详情封装，允许测试修改正文或身份。 */
const detail = (
  id: string,
): {
  code: number;
  zpData: { jobInfo: { encryptId: string; jobName: string; postDescription: string } };
} => ({
  code: 0,
  zpData: {
    jobInfo: { encryptId: id, jobName: '测试职位', postDescription: '负责业务系统开发与维护。' },
  },
});

/** 使用合成响应与递增时钟测试，不连接真实浏览器或招聘平台。 */
function session(responses: unknown[]): {
  client: BossHttpSession;
  requests: { url: URL; init?: RequestInit }[];
} {
  let now = 1_800_000_000_000;
  const requests: { url: URL; init?: RequestInit }[] = [];
  const fetcher: typeof fetch = (input, init) => {
    requests.push({
      url: new URL(input instanceof Request ? input.url : input),
      ...(init ? { init } : {}),
    });
    const response = responses.shift();
    return Promise.resolve(response instanceof Response ? response : Response.json(response));
  };
  return {
    client: new BossHttpSession({
      cookies: [cookie],
      observedListUrl,
      fetch: fetcher,
      now: () => (now += 6_000),
    }),
    requests,
  };
}

describe('BOSS HTTP 会话', () => {
  it.each(['unknown', 'identity', 'long_wait', 'cancel'] as const)(
    '传输重试边界 %s 不继续请求',
    async (mode) => {
      let now = 1_800_000_000_000;
      const controller = new AbortController();
      const wait = vi.spyOn(timers, 'setTimeout').mockImplementation(() => {
        controller.abort();
        return Promise.reject(new DOMException('cancelled', 'AbortError'));
      });
      const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(page(['a'])));
      if (mode === 'unknown') fetcher.mockRejectedValueOnce(new TypeError('private'));
      else if (mode === 'cancel')
        fetcher.mockRejectedValueOnce(Object.assign(new Error('private'), { code: 'ECONNRESET' }));
      else
        fetcher.mockResolvedValueOnce(
          mode === 'identity'
            ? Response.json(detail('other'))
            : new Response('', {
                status: 429,
                headers: { 'retry-after': '99999999999999999999999999999' },
              }),
        );
      const client = new BossHttpSession({
        cookies: [cookie],
        observedListUrl,
        fetch: fetcher,
        now: () => (now += 5000),
      });
      try {
        await client.readNext(controller.signal);
        await expect(client.readDetail('a', controller.signal)).rejects.toThrow();
        expect(fetcher).toHaveBeenCalledTimes(2);
        expect(wait).toHaveBeenCalledTimes(mode === 'cancel' ? 1 : 0);
      } finally {
        client.disconnect();
        wait.mockRestore();
      }
    },
  );
  it('网络预算跨 37 恢复保留，退避独立计数且不重抓列表', async () => {
    let now = 1_800_000_000_000;
    let version = 0;
    const wait = vi.spyOn(timers, 'setTimeout').mockImplementation((delay) => {
      now += Number(delay);
      return Promise.resolve(undefined);
    });
    const context = (): { token: string; cookies: BrowserCookie[] } => ({
      token: 'ordinary',
      cookies: [
        { ...cookie, name: 'wt2', value: 'account' },
        { ...cookie, name: 'bst', value: 'bst' },
        { ...cookie, name: '__zp_stoken__', value: `security-${String(version)}` },
      ],
    });
    const network = (): TypeError =>
      new TypeError('private', {
        cause: Object.assign(new Error('private'), { code: 'ECONNRESET' }),
      });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(page(['a'])));
    for (let i = 0; i < 3; i++)
      fetcher.mockRejectedValueOnce(network()).mockResolvedValueOnce(Response.json({ code: 37 }));
    fetcher.mockRejectedValueOnce(network());
    const client = new BossHttpSession({
      ...context(),
      observedListUrl,
      fetch: fetcher,
      readContext: () => Promise.resolve(context()),
      now: () => (now += 5000),
    });
    const signal = new AbortController().signal;
    try {
      await client.readNext(signal);
      for (let i = 0; i < 3; i++) {
        await expect(client.readDetail('a', signal)).rejects.toMatchObject({ businessCode: 37 });
        version++;
        await client.resume(signal);
      }
      await expect(client.readDetail('a', signal)).rejects.toMatchObject({
        category: 'network_error',
        reason: 'connection_reset',
      });
      expect(wait.mock.calls.map(([delay]) => delay)).toEqual([5000, 10000, 20000]);
      expect(fetcher).toHaveBeenCalledTimes(8);
    } finally {
      client.disconnect();
      wait.mockRestore();
    }
  });

  it.each([429, 503])('HTTP %s 遵守 Retry-After，成功后返回同一完整详情', async (status) => {
    let now = 1_800_000_000_000;
    const wait = vi.spyOn(timers, 'setTimeout').mockImplementation((delay) => {
      now += Number(delay);
      return Promise.resolve(undefined);
    });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(page(['a'])))
      .mockResolvedValueOnce(new Response('', { status, headers: { 'retry-after': '12' } }))
      .mockResolvedValueOnce(Response.json(detail('a')));
    const client = new BossHttpSession({
      cookies: [cookie],
      observedListUrl,
      fetch: fetcher,
      now: () => (now += 5000),
    });
    try {
      const signal = new AbortController().signal;
      await client.readNext(signal);
      await expect(client.readDetail('a', signal)).resolves.toMatchObject({ externalJobId: 'a' });
      expect(wait).toHaveBeenCalledWith(12000, undefined, expect.anything());
      expect(fetcher).toHaveBeenCalledTimes(3);
    } finally {
      client.disconnect();
      wait.mockRestore();
    }
  });
  it('每段必须更新安全上下文，五次有效恢复后终止', async () => {
    let now = 1_800_000_000_000;
    let version = 0;
    const context = (): { token: string; cookies: BrowserCookie[] } => ({
      token: 'ordinary',
      cookies: [
        { ...cookie, name: 'wt2', value: 'account' },
        { ...cookie, name: 'bst', value: `bst-${String(version)}` },
        { ...cookie, name: '__zp_stoken__', value: `security-${String(version)}` },
      ],
    });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(page(['a'])))
      .mockImplementation(() => Promise.resolve(Response.json({ code: 37 })));
    const client = new BossHttpSession({
      ...context(),
      observedListUrl,
      fetch: fetcher,
      readContext: () => Promise.resolve(context()),
      now: () => (now += 6000),
    });
    const signal = new AbortController().signal;
    await client.readNext(signal);
    await expect(client.readDetail('a', signal)).rejects.toThrow();
    for (let i = 1; i <= 5; i++) {
      await expect(client.resume(signal)).rejects.toMatchObject({ reason: 'context_unchanged' });
      version = i;
      await client.resume(signal);
      await expect(client.readDetail('a', signal)).rejects.toMatchObject({ businessCode: 37 });
    }
    version++;
    await expect(client.resume(signal)).rejects.toMatchObject({ category: 'session_unavailable' });
    expect(fetcher).toHaveBeenCalledTimes(7);
    client.disconnect();
  });
  it.each(['success', 'again', 'account', 'expired', 'cancel', 'missing', 'read_failure'] as const)(
    '显式恢复 %s：只接受官网更新上下文，保留原详情参数并限制一次续跑',
    async (mode) => {
      let now = 1_800_000_000_000;
      let security = 'old-security';
      let account = 'account-a';
      let bst = 'ordinary-bst';
      let readFailure = false;
      let missing = false;
      const context = (): { token: string; cookies: BrowserCookie[] } => ({
        token: missing ? '' : 'ordinary-token',
        cookies: [
          { ...cookie, name: 'wt2', value: account },
          { ...cookie, name: 'bst', value: bst },
          { ...cookie, name: '__zp_stoken__', value: security },
        ],
      });
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(Response.json(page(['a'])))
        .mockResolvedValueOnce(Response.json({ code: 37, zpData: { seed: 'private' } }))
        .mockResolvedValueOnce(Response.json(mode === 'again' ? { code: 37 } : detail('a')));
      const client = new BossHttpSession({
        ...context(),
        observedListUrl,
        fetch: fetcher,
        readContext: () =>
          readFailure ? Promise.reject(new Error('private-data')) : Promise.resolve(context()),
        now: () => (now += 6000),
      });
      const signal = new AbortController().signal;
      await client.readNext(signal);
      await expect(client.readDetail('a', signal)).rejects.toMatchObject({ businessCode: 37 });
      await expect(client.readDetail('a', signal)).rejects.toMatchObject({
        category: 'session_unavailable',
      });
      await expect(client.resume(signal)).rejects.toMatchObject({ reason: 'context_unchanged' });
      expect(fetcher).toHaveBeenCalledTimes(2);
      security = 'updated-by-normal-browser';
      bst = 'rotated-by-normal-browser';
      if (mode === 'account') account = 'account-b';
      if (mode === 'expired') now += 600_000;
      if (mode === 'missing') missing = true;
      if (mode === 'read_failure') readFailure = true;
      const controller = new AbortController();
      if (mode === 'cancel') controller.abort();
      if (['account', 'expired', 'cancel', 'missing', 'read_failure'].includes(mode)) {
        if (mode === 'cancel') await expect(client.resume(controller.signal)).rejects.toThrow();
        else
          await expect(client.resume(controller.signal)).rejects.toMatchObject({
            reason:
              mode === 'account'
                ? 'auth_binding_changed'
                : mode === 'expired'
                  ? 'resume_expired'
                  : mode === 'missing'
                    ? 'auth_context_missing'
                    : 'context_read_failed',
          });
        await expect(client.resume(signal)).rejects.toMatchObject({
          category: 'session_unavailable',
        });
        expect(fetcher).toHaveBeenCalledTimes(2);
      } else {
        await client.resume(signal);
        expect(fetcher).toHaveBeenCalledTimes(2);
        if (mode === 'again') {
          await expect(client.readDetail('a', signal)).rejects.toMatchObject({ businessCode: 37 });
          await expect(client.resume(signal)).rejects.toMatchObject({
            category: 'session_unavailable',
          });
        } else
          await expect(client.readDetail('a', signal)).resolves.toMatchObject({
            externalJobId: 'a',
          });
        expect(fetcher).toHaveBeenCalledTimes(3);
        expect(new Headers(fetcher.mock.calls[2]?.[1]?.headers).get('zp_token')).toBe(bst);
        expect((fetcher.mock.calls[2]?.[0] as URL).searchParams.get('securityId')).toBe(
          'private-a',
        );
      }
      client.disconnect();
    },
  );
  it('计时器提前唤醒后继续核对五秒边界，不提前发送下一页', async () => {
    // 1、第二次调用的前几次时钟读取仍停在 4999ms，模拟提前唤醒后边界未到。
    const base = 1_800_000_000_000;
    let second = false;
    let reads = 0;
    const timestamps: number[] = [];
    const client = new BossHttpSession({
      cookies: [cookie],
      observedListUrl,
      now: () => base + (second ? (++reads <= 4 ? 4_999 : 5_000) : 0),
      fetch: (input) => {
        timestamps.push(
          Number(new URL(input instanceof Request ? input.url : input).searchParams.get('_')),
        );
        return Promise.resolve(Response.json(page([String(timestamps.length)])));
      },
    });
    // 2、只模拟本地响应；时钟真正跨过边界后才允许第二次 HTTP。
    await client.readNext(new AbortController().signal);
    second = true;
    await client.readNext(new AbortController().signal);
    expect(timestamps).toEqual([base, base + 5_000]);
    client.disconnect();
  });

  it('列表和详情的时间戳在读取认证上下文后按实际发送时刻生成', async () => {
    // 1、模拟读取上下文耗时，离线重现排队前构造 URL 导致的陈旧时间戳。
    let now = 1_800_000_000_000;
    const requests: { timestamp: string | null; sentAt: number }[] = [];
    const responses = [page(['a']), detail('a')];
    const client = new BossHttpSession({
      cookies: [cookie],
      observedListUrl,
      now: () => now,
      readContext: () => {
        now += 1_000;
        return Promise.resolve({ cookies: [cookie] });
      },
      fetch: (input) => {
        requests.push({
          timestamp: new URL(input instanceof Request ? input.url : input).searchParams.get('_'),
          sentAt: now,
        });
        return Promise.resolve(Response.json(responses.shift()));
      },
    });
    // 2、覆盖两个端点；显式推进时钟避免测试向真实网站请求或等待节流。
    await client.readNext(new AbortController().signal);
    now += 5_000;
    await client.readDetail('a', new AbortController().signal);
    expect(requests).toHaveLength(2);
    for (const request of requests) expect(request.timestamp).toBe(String(request.sentAt));
    client.disconnect();
  });

  it('每次请求只读新认证上下文，不发送浏览器特征或保留旧 token', async () => {
    let now = Date.now();
    const readContext = vi
      .fn()
      .mockResolvedValueOnce({
        cookies: [{ ...cookie, name: 'bst', value: 'auth-one' }],
        token: 'page-one',
      })
      .mockResolvedValueOnce({ cookies: [{ ...cookie, name: 'bst', value: 'auth-two' }] });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(page(['a'])))
      .mockResolvedValueOnce(Response.json(detail('a')));
    const client = new BossHttpSession({
      cookies: [cookie],
      observedListUrl,
      readContext,
      fetch: fetcher,
      now: () => (now += 6_000),
    });
    await client.readNext(new AbortController().signal);
    await client.readDetail('a', new AbortController().signal);
    const first = new Headers(fetcher.mock.calls[0]?.[1]?.headers);
    const second = new Headers(fetcher.mock.calls[1]?.[1]?.headers);
    expect(first.get('token')).toBe('page-one');
    expect(first.get('zp_token')).toBe('auth-one');
    expect(second.get('token')).toBeNull();
    expect(second.get('zp_token')).toBe('auth-two');
    expect(second.get('cookie')).toBe('bst=auth-two');
    expect([...first.keys()].sort()).toEqual([
      'accept',
      'cookie',
      'referer',
      'token',
      'x-requested-with',
      'zp_token',
    ]);
    expect(readContext).toHaveBeenCalledTimes(2);
  });

  it.each(['failure', 'cancel'] as const)(
    '上下文同步 %s 后不得使用旧 Cookie 请求',
    async (mode) => {
      const controller = new AbortController();
      const fetcher = vi.fn();
      const client = new BossHttpSession({
        cookies: [cookie],
        observedListUrl,
        fetch: fetcher,
        readContext: () => {
          if (mode === 'failure') return Promise.reject(new Error('private-context'));
          controller.abort();
          return Promise.resolve({ cookies: [cookie], token: 'new-token' });
        },
      });
      await expect(client.readNext(controller.signal)).rejects.toMatchObject({
        category: 'session_unavailable',
      });
      await expect(client.readNext(new AbortController().signal)).rejects.toMatchObject({
        category: 'session_unavailable',
      });
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it('认证头拒绝注入且不使用其他域的 bst', async () => {
    expect(
      () =>
        new BossHttpSession({
          cookies: [cookie],
          observedListUrl,
          token: 'secret\r\nInjected: yes',
        }),
    ).toThrow('session_unavailable');
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(page(['a'])));
    const client = new BossHttpSession({
      cookies: [cookie, { ...cookie, name: 'bst', domain: '.example.com' }],
      observedListUrl,
      fetch: fetcher,
    });
    await client.readNext(new AbortController().signal);
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).has('zp_token')).toBe(false);
  });

  it('排除空公司 ID 并计数，全被排除的一批不冒充末页', async () => {
    const { client } = session([
      {
        code: 0,
        zpData: {
          hasMore: true,
          lid: 'root',
          jobList: [{ ...row('anonymous'), encryptBrandId: '' }],
        },
      },
      page(['valid'], false),
    ]);
    const signal = new AbortController().signal;
    expect(await client.readNext(signal)).toEqual({
      candidates: [],
      hasMore: true,
      skippedMissingCompanyId: 1,
    });
    expect((await client.readNext(signal)).candidates).toHaveLength(1);
  });

  it('公司 ID 未知类型仍阻断整批', async () => {
    const { client } = session([
      {
        code: 0,
        zpData: {
          hasMore: true,
          lid: 'root',
          jobList: [{ ...row('unknown'), encryptBrandId: null }],
        },
      },
    ]);
    await expect(client.readNext(new AbortController().signal)).rejects.toMatchObject({
      category: 'parse_changed',
    });
  });
  it('两批列表和基于本批条目参数的详情闭环，不返回临时访问参数', async () => {
    const { client, requests } = session([page(['a']), page(['b']), detail('b')]);
    const signal = new AbortController().signal;
    expect((await client.readNext(signal)).candidates[0]?.externalJobId).toBe('a');
    const second = await client.readNext(signal);
    expect(second.candidates[0]?.externalJobId).toBe('b');
    expect(JSON.stringify(second)).not.toContain('private-');
    expect(JSON.stringify(second)).not.toContain('item-lid');
    expect((await client.readDetail('b', signal)).description).toContain('业务系统');
    expect(requests.map((r) => r.url.searchParams.get('page'))).toEqual(['1', '2', null]);
    expect(requests[2]?.url.searchParams.get('lid')).toBe('item-lid');
    expect(requests[2]?.url.searchParams.get('securityId')).toBe('private-b');
    expect(requests.every((r) => r.init?.redirect === 'manual')).toBe(true);
  });

  it('环境异常 37 分类为访问受限，冻结会话且不泄露错误原文', async () => {
    const { client, requests } = session([{ code: 37, message: '您的环境存在异常. test-secret' }]);
    const error: unknown = await client
      .readNext(new AbortController().signal)
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ category: 'access_blocked', businessCode: 37 });
    expect(error instanceof Error ? error.message : '').not.toContain('test-secret');
    await expect(client.readNext(new AbortController().signal)).rejects.toMatchObject({
      category: 'session_unavailable',
    });
    expect(requests).toHaveLength(1);
  });

  it('未知业务码不归为未登录', async () => {
    const { client } = session([{ code: 99999, message: 'private response' }]);
    await expect(client.readNext(new AbortController().signal)).rejects.toMatchObject({
      category: 'upstream_error',
      businessCode: 99999,
    });
  });

  it('后续页 37 保留本会话现场，检查字段值不泄露且禁止继续请求', async () => {
    // 1、首批成功后模拟安全检查，不把不同会话的历史成功混入计数。
    const { client, requests } = session([
      page(['a']),
      {
        code: 37,
        zpData: {
          seed: 'private-seed',
          name: 'private-name',
          ts: 'private-ts',
          secret: 'private-value',
        },
      },
    ]);
    await client.readNext(new AbortController().signal);
    const error: unknown = await client
      .readNext(new AbortController().signal)
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ category: 'access_blocked', businessCode: 37 });
    const message = error instanceof Error ? error.message : '';
    expect(message).toContain(
      'boss:http:list;request=2;priorCode0=1;check=seed+name+ts;browserState=unknown',
    );
    expect(message).not.toMatch(/private|secret/);
    // 2、安全检查不是空末页，后续调用冻结而非使用旧参数重试。
    await expect(client.readNext(new AbortController().signal)).rejects.toMatchObject({
      category: 'session_unavailable',
    });
    expect(requests).toHaveLength(2);
  });

  it.each([page(['a', 'a']), page([])])('拒绝重复 ID 或矛盾空页', async (response) => {
    const { client } = session([response]);
    await expect(client.readNext(new AbortController().signal)).rejects.toMatchObject({
      category: 'parse_changed',
    });
  });

  it('重复批次不是正常末页', async () => {
    const { client } = session([page(['a']), page(['a'])]);
    await client.readNext(new AbortController().signal);
    await expect(client.readNext(new AbortController().signal)).rejects.toMatchObject({
      category: 'parse_changed',
    });
  });

  it('明确末页之后不继续请求', async () => {
    const { client, requests } = session([page([], false)]);
    expect(await client.readNext(new AbortController().signal)).toEqual({
      candidates: [],
      hasMore: false,
      skippedMissingCompanyId: 0,
    });
    await client.readNext(new AbortController().signal);
    expect(requests).toHaveLength(1);
  });

  it.each(['different-id', 'empty-body'])('拒绝错误身份或空正文：%s', async (mode) => {
    const response = detail(mode === 'different-id' ? 'b' : 'a');
    if (mode === 'empty-body') response.zpData.jobInfo.postDescription = '  ';
    const { client } = session([page(['a']), response]);
    await client.readNext(new AbortController().signal);
    await expect(client.readDetail('a', new AbortController().signal)).rejects.toMatchObject({
      category: 'parse_changed',
    });
  });

  it('重定向不转发凭据', async () => {
    const { client, requests } = session([
      new Response(null, { status: 302, headers: { location: 'https://example.com' } }),
    ]);
    await expect(client.readNext(new AbortController().signal)).rejects.toMatchObject({
      category: 'upstream_error',
    });
    expect(requests).toHaveLength(1);
  });

  it('拒绝超大响应', async () => {
    const { client } = session([new Response('x'.repeat(2 * 1_024 * 1_024 + 1))]);
    await expect(client.readNext(new AbortController().signal)).rejects.toMatchObject({
      category: 'parse_changed',
    });
  });

  it('取消后不发请求', async () => {
    const { client, requests } = session([]);
    const abort = new AbortController();
    abort.abort();
    await expect(client.readNext(abort.signal)).rejects.toBeDefined();
    expect(requests).toHaveLength(0);
  });

  it('断开后丢弃迟到结果', async () => {
    let release!: (response: Response) => void;
    const fetcher = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    const client = new BossHttpSession({ cookies: [cookie], observedListUrl, fetch: fetcher });
    const result = client.readNext(new AbortController().signal);
    client.disconnect();
    release(Response.json(page(['a'])));
    await expect(result).rejects.toBeDefined();
    await expect(client.readDetail('a', new AbortController().signal)).rejects.toMatchObject({
      category: 'session_unavailable',
    });
  });

  it('任意站点或查询注入在请求前拒绝', () => {
    for (const url of [
      'https://example.com',
      `${observedListUrl}&unknown=1`,
      `https://user:pass@www.zhipin.com/wapi/zpgeek/pc/recommend/job/list.json`,
    ]) {
      expect(() => new BossHttpSession({ cookies: [cookie], observedListUrl: url })).toThrow();
    }
  });
});

describe('站点 Cookie 最小作用域', () => {
  const target = new URL(observedListUrl);
  it('匹配域、路径、有效期并拒绝不相关站点', () => {
    const values = [
      cookie,
      { ...cookie, name: 'expired', expires: 1 },
      { ...cookie, name: 'other', domain: '.example.com' },
      { ...cookie, name: 'wrongpath', path: '/wapi/zpgeek/pc/recommend/job/list.json/child' },
      { ...cookie, name: 'hostonly', domain: 'zhipin.com' },
    ];
    expect(cookieHeaderForUrl(values, target, Date.now())).toBe('session=test-secret');
    expect(cookieHeaderForUrl(values, new URL('https://other.zhipin.com'), Date.now())).toBe('');
    expect(cookieHeaderForUrl(values, new URL('http://www.zhipin.com'), Date.now())).toBe('');
  });
  it('拒绝头部注入且更具体路径优先', () => {
    expect(cookieHeaderForUrl([{ ...cookie, value: 'bad\r\nheader' }], target, Date.now())).toBe(
      '',
    );
    expect(
      cookieHeaderForUrl(
        [cookie, { ...cookie, value: 'scoped', path: '/wapi/' }],
        target,
        Date.now(),
      ),
    ).toBe('session=scoped; session=test-secret');
  });
});
