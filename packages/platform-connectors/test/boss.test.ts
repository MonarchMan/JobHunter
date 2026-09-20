import { describe, expect, it, vi } from 'vitest';
import { BossHttpSession, cookieHeaderForUrl, type BrowserCookie } from '../src/index.js';

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
