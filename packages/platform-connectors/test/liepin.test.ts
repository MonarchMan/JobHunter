import { expect, it, vi, type Mock } from 'vitest';
import {
  LiepinRecommendationHttpSession,
  liepinCookieHeader,
  liepinRequestHeaders,
} from '../src/liepin.js';

const signal = new AbortController().signal;
const url = 'https://www.liepin.com/job/1980000001.shtml';
const row = {
  job: {
    jobId: 80000001,
    title: '开发工程师',
    link: url,
    dq: '成都',
    salary: '面议',
    requireEduLevel: '本科',
  },
  comp: { compId: 123, compName: '测试企业' },
};
const posting = {
  '@type': 'JobPosting',
  title: '开发工程师',
  url,
  identifier: { propertyID: 'liepin.com', value: '80000001' },
  hiringOrganization: { name: '测试企业', sameAs: 'https://www.liepin.com/company/123/' },
  description: '负责业务系统开发、编写单元测试和维护技术文档。',
};
const template = {
  url: 'https://api-c.liepin.com/api/com.liepin.csearch.home-recommend-job-new',
  body: JSON.stringify({
    data: {
      operateKind: 'LOGIN',
      sortType: 'PC_STU_HP_NEW',
      selectedExpect: '{}',
      existFallbackResult: false,
    },
  }),
};

/** 合成 JSON 和 HTML 替身，不需要浏览器或真实账号。 */
function fixture(
  list: unknown = { flag: 1, data: { data: [], addData: [row], hasNextPage: true } },
  detail: unknown = posting,
): {
  session: LiepinRecommendationHttpSession;
  fetcher: Mock<typeof fetch>;
  readHeaders: Mock<(target: string) => Promise<{ cookie: string; 'x-xsrf-token': string }>>;
} {
  let now = 0;
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json(list))
    .mockResolvedValueOnce(
      new Response(`<script type="application/ld+json">${JSON.stringify(detail)}</script>`, {
        headers: { 'content-type': 'text/html' },
      }),
    );
  const readHeaders = vi.fn((target: string) =>
    Promise.resolve({
      cookie: target === url ? 'detail=private-detail' : 'api=private-api',
      'x-xsrf-token': 'private-token',
    }),
  );
  const session = new LiepinRecommendationHttpSession({
    template,
    fetch: fetcher,
    readHeaders,
    now: () => (now += 5001),
  });
  return { session, fetcher, readHeaders };
}

it('合并补充推荐并核验 JSON-LD，详情不携带 API 专用头', async () => {
  const { session, fetcher, readHeaders } = fixture();
  const batch = await session.readNext(signal);
  expect(batch).toMatchObject({
    hasMore: true,
    candidates: [{ externalJobId: 'job:1980000001', externalCompanyId: '123' }],
  });
  expect(await session.readDetail('job:1980000001', signal)).toMatchObject({
    description: posting.description,
  });
  expect(readHeaders.mock.calls.map((call) => call[0])).toEqual([template.url, url]);
  expect(fetcher.mock.calls[1]?.[1]).toMatchObject({
    redirect: 'manual',
    headers: { accept: 'text/html', cookie: 'detail=private-detail' },
  });
  expect(fetcher.mock.calls[1]?.[1]?.headers).not.toHaveProperty('x-xsrf-token');
  expect(JSON.stringify(batch)).not.toContain('private-');
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('首次 LOGIN、续批 UP 保留查询与排序，末批之后不再请求', async () => {
  const { session, fetcher } = fixture();
  fetcher
    .mockReset()
    .mockResolvedValueOnce(
      Response.json({ flag: 1, data: { data: [row], addData: [], hasNextPage: true } }),
    )
    .mockResolvedValueOnce(
      Response.json({
        flag: 1,
        data: {
          data: [
            {
              ...row,
              job: {
                ...row.job,
                jobId: 80000002,
                link: 'https://www.liepin.com/job/1980000002.shtml',
              },
            },
          ],
          addData: [],
          hasNextPage: false,
        },
      }),
    );
  await session.readNext(signal);
  expect(await session.readNext(signal)).toMatchObject({
    hasMore: false,
    candidates: [{ externalJobId: 'job:1980000002' }],
  });
  expect(
    fetcher.mock.calls.map((call) => {
      const body = call[1]?.body;
      if (typeof body !== 'string') throw new Error('Missing request body');
      return JSON.parse(body) as unknown;
    }),
  ).toEqual([
    JSON.parse(template.body) as unknown,
    {
      data: {
        operateKind: 'UP',
        sortType: 'PC_STU_HP_NEW',
        selectedExpect: '{}',
        existFallbackResult: false,
      },
    },
  ]);
  await expect(session.readNext(signal)).rejects.toMatchObject({ category: 'session_unavailable' });
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('跨批重复身份冻结且不请求旧详情', async () => {
  const { session, fetcher } = fixture();
  fetcher
    .mockReset()
    .mockImplementation(() =>
      Promise.resolve(
        Response.json({ flag: 1, data: { data: [row], addData: [], hasNextPage: true } }),
      ),
    );
  await session.readNext(signal);
  await expect(session.readNext(signal)).rejects.toMatchObject({ category: 'parse_changed' });
  await expect(session.readDetail('job:1980000001', signal)).rejects.toMatchObject({
    category: 'session_unavailable',
  });
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('Cookie 按域、路径、过期和同名优先级匹配，不复用浏览器特征头', () => {
  const cookie = {
    name: 'sid',
    value: 'root',
    domain: '.liepin.com',
    path: '/',
    expires: -1,
    secure: true,
  };
  expect(
    liepinCookieHeader(
      [
        cookie,
        { ...cookie, value: 'job', path: '/job' },
        { ...cookie, value: 'other', domain: 'api-c.liepin.com' },
        { ...cookie, value: 'expired', expires: 1 },
        { ...cookie, value: 'bad;value' },
        { ...cookie, value: 'prefix', path: '/jo' },
      ],
      url,
      2000,
    ),
  ).toBe('sid=job; sid=root');
  expect(liepinCookieHeader([cookie], 'https://evil.test/job/1', 0)).toBe('');
  expect(
    liepinRequestHeaders({
      Cookie: 'secret',
      Accept: 'application/json',
      'User-Agent': 'browser',
      'X-XSRF-TOKEN': 'token',
    }),
  ).toEqual({ accept: 'application/json', 'x-xsrf-token': 'token' });
});

it.each([
  { ...posting, identifier: { propertyID: 'liepin.com', value: '999' } },
  {
    ...posting,
    hiringOrganization: { name: '测试企业', sameAs: 'https://www.liepin.com/company/999/' },
  },
  { ...posting, url: 'https://evil.test/job/1980000001.shtml' },
  { ...posting, title: '不同职位' },
  { ...posting, description: '<p>未经支持的正文</p>' },
  { ...posting, description: '' },
])('详情身份或正文异常冻结，不能入库或重试', async (detail) => {
  const { session, fetcher } = fixture(undefined, detail);
  await session.readNext(signal);
  await expect(session.readDetail('job:1980000001', signal)).rejects.toMatchObject({
    category: 'parse_changed',
  });
  await expect(session.readDetail('job:1980000001', signal)).rejects.toMatchObject({
    category: 'session_unavailable',
  });
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('重复页和异常空页不能冒充成功', async () => {
  for (const rows of [[], [row, row]]) {
    const { session } = fixture({ flag: 1, data: { data: rows, addData: [], hasNextPage: true } });
    await expect(session.readNext(signal)).rejects.toMatchObject({ category: 'parse_changed' });
  }
});

it('已知缺公司身份计数排除，未知类型仍报错', async () => {
  const missing = { ...row, comp: { ...row.comp, compId: null } };
  expect(
    await fixture({
      flag: 1,
      data: { data: [missing], addData: [], hasNextPage: false },
    }).session.readNext(signal),
  ).toMatchObject({ candidates: [], skippedMissingCompanyId: 1 });
  await expect(
    fixture({
      flag: 1,
      data: {
        data: [{ ...row, comp: { compName: '测试企业', compId: {} } }],
        addData: [],
        hasNextPage: false,
      },
    }).session.readNext(signal),
  ).rejects.toMatchObject({ category: 'parse_changed' });
});

it('未知业务码保留代码但不泄露原始文本或重试', async () => {
  const { session, fetcher } = fixture({ flag: 0, code: '-1400', msg: 'private-token' });
  await expect(session.readNext(signal)).rejects.toMatchObject({
    category: 'upstream_error',
    businessCode: -1400,
  });
  await expect(session.readNext(signal)).rejects.not.toThrow('private-token');
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('重定向登录墙不跟随，不向新目标携带 Cookie', async () => {
  const { session, fetcher } = fixture();
  await session.readNext(signal);
  fetcher
    .mockReset()
    .mockResolvedValue(
      new Response(null, { status: 302, headers: { location: 'https://wow.liepin.com/login' } }),
    );
  await expect(session.readDetail('job:1980000001', signal)).rejects.toMatchObject({
    category: 'access_blocked',
    businessCode: 302,
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('任意模板、未观察详情和取消均不会发网络请求', async () => {
  expect(
    () =>
      new LiepinRecommendationHttpSession({
        template: { ...template, url: 'https://evil.test' },
        readHeaders: () => Promise.resolve({}),
      }),
  ).toThrow('[liepin:template]');
  const { session, fetcher } = fixture();
  await expect(session.readDetail('unknown', signal)).rejects.toMatchObject({
    category: 'session_unavailable',
  });
  expect(fetcher).not.toHaveBeenCalled();
  const other = fixture();
  await expect(other.session.readNext(AbortSignal.abort())).rejects.toMatchObject({
    category: 'session_unavailable',
  });
  expect(other.fetcher).not.toHaveBeenCalled();
});

it('非 JSON、超限或登录壳正文不误报成功', async () => {
  const { session, fetcher } = fixture();
  fetcher
    .mockReset()
    .mockResolvedValue(new Response('登录', { headers: { 'content-type': 'text/html' } }));
  await expect(session.readNext(signal)).rejects.toMatchObject({ category: 'parse_changed' });
  const next = fixture();
  next.fetcher.mockReset().mockResolvedValue(
    new Response(' '.repeat(2 * 1024 * 1024 + 1), {
      headers: { 'content-type': 'application/json' },
    }),
  );
  await expect(next.session.readNext(signal)).rejects.toMatchObject({ category: 'parse_changed' });
});
