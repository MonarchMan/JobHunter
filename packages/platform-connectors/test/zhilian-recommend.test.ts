import { expect, it, vi } from 'vitest';
import { ZhilianCampusHttpSession, type ZhilianCampusRequestTemplate } from '../src/index.js';

const template: ZhilianCampusRequestTemplate = {
  url: 'https://cgate.zhaopin.com/positionbusiness/searchRecommendCampus/searchRecommendCampusPcSubject?x-zp-page-request-id=one&x-zp-page-request-id=two',
  headers: {
    'x-zp-at': 'secret-at',
    'x-zp-rt': 'secret-rt',
    'x-zp-platform': '14',
    'x-zp-business-system': '40',
    Cookie: 'ignored-secret',
  },
  body: JSON.stringify({
    at: 'secret-at',
    rt: 'secret-rt',
    d: 'secret-d',
    identity: '1',
    filterMinSalary: 1,
    resumeNumber: 'resume-ref',
    subjectType: 3,
    eventScenario: 'pcPurposeRecommend',
    pageIndex: 1,
    pageSize: 20,
    browsedJobNumbers: '',
    clickedJobNumbers: [],
    channel: 'xiaoyuan',
    platform: '14',
    version: '0.0.0',
  }),
};
const row = {
  number: 'CC_TEST',
  name: '测试职位',
  companyNumber: 'KA_TEST',
  companyName: '测试公司',
  workCity: '成都',
  salary60: '面议',
  education: '本科',
  workingExp: '',
};
const detail = {
  statusCode: 200,
  data: {
    positionDetail: {
      positionNumber: 'CC_TEST',
      positionName: '测试职位',
      jobDesc: '开发与测试。',
      positionWorkCity: '成都',
      positionWorkingExp: '',
      salary60: '面议',
      education: '本科',
    },
    companyDetail: { companyNumber: 'KA_TEST', companyName: '测试公司' },
  },
};
/** 使用递增时钟跳过实验节流等待；请求本身完全使用合成响应。 */
function setup(responses: unknown[]): {
  session: ZhilianCampusHttpSession;
  fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
} {
  let now = 0;
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(() => Promise.resolve(new Response(JSON.stringify(responses.shift()))));
  return {
    session: new ZhilianCampusHttpSession({ template, fetch: fetcher, now: () => (now += 30_001) }),
    fetcher,
  };
}
it('gets recommendation then requests live detail without replay or prefetch', async () => {
  const { session, fetcher } = setup([
    { statusCode: 200, data: { list: [row], isEndPage: 0 } },
    detail,
  ]);
  const signal = new AbortController().signal;
  const batch = await session.readNext(signal);
  expect(batch.candidates).toHaveLength(1);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect((await session.readDetail('CC_TEST', signal)).externalCompanyId).toBe('KA_TEST');
  expect(fetcher).toHaveBeenCalledTimes(2);
  const calls = fetcher.mock.calls;
  expect(calls[0]?.[0]).toBe(template.url);
  expect(new Headers(calls[0]?.[1]?.headers).has('Cookie')).toBe(false);
  expect(calls[1]?.[0]).toBe(
    'https://cgate.zhaopin.com/positionbusiness/exposure/getPositionDetail',
  );
  expect(JSON.stringify(batch)).not.toContain('secret');
});
it.each([
  'https://evil.example/path',
  'https://cgate.zhaopin.com/positionbusiness/searchRecommendCampus/searchRecommendCampusPcSubject?unknown=x',
])('rejects untrusted URL %s', (url) => {
  expect(() => new ZhilianCampusHttpSession({ template: { ...template, url } })).toThrow(
    'parse_changed',
  );
});
it('rejects unknown body fields and inconsistent auth without sending requests', () => {
  expect(
    () =>
      new ZhilianCampusHttpSession({
        template: {
          ...template,
          body: JSON.stringify({ ...JSON.parse(template.body), unknown: 'x' }),
        },
      }),
  ).toThrow('parse_changed');
  expect(
    () =>
      new ZhilianCampusHttpSession({
        template: { ...template, headers: { ...template.headers, 'x-zp-at': 'wrong' } },
      }),
  ).toThrow('parse_changed');
});
it.each([
  { list: [], isEndPage: 0 },
  { list: [row, row], isEndPage: 1 },
])('freezes on contradictory or duplicated lists', async (data) => {
  const { session, fetcher } = setup([{ statusCode: 200, data }]);
  await expect(session.readNext(new AbortController().signal)).rejects.toThrow('parse_changed');
  await expect(session.readNext(new AbortController().signal)).rejects.toThrow(
    'session_unavailable',
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('counts anonymous companies and rejects a repeated anonymous page', async () => {
  const page = { statusCode: 200, data: { list: [{ ...row, companyNumber: '' }], isEndPage: 0 } };
  const { session } = setup([page, page]);
  expect(await session.readNext(new AbortController().signal)).toMatchObject({
    candidates: [],
    hasMore: true,
    skippedMissingCompanyId: 1,
  });
  await expect(session.readNext(new AbortController().signal)).rejects.toThrow('parse_changed');
});
it('rejects detail company mismatch', async () => {
  const { session } = setup([
    { statusCode: 200, data: { list: [row], isEndPage: 1 } },
    {
      ...detail,
      data: { ...detail.data, companyDetail: { companyNumber: 'other', companyName: '测试公司' } },
    },
  ]);
  await session.readNext(new AbortController().signal);
  await expect(session.readDetail('CC_TEST', new AbortController().signal)).rejects.toThrow(
    'parse_changed',
  );
});
it('does not request undiscovered IDs', async () => {
  const { session, fetcher } = setup([]);
  await expect(session.readDetail('other', new AbortController().signal)).rejects.toThrow(
    'session_unavailable',
  );
  expect(fetcher).not.toHaveBeenCalled();
});
