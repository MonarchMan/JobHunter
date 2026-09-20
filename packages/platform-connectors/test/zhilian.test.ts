import { expect, it, vi } from 'vitest';
import { parseZhilianCampusDetail, ZhilianCampusSelectionSession } from '../src/index.js';

const selection = { externalJobId: 'CC_TEST', title: '研发实习生', company: '测试企业' };
/** 合成夹具只包含公开职位字段，禁止落盘账号令牌和真实 HR 信息。 */
const fixture = {
  statusCode: 200,
  data: {
    positionDetail: {
      positionNumber: 'CC_TEST',
      positionName: '研发实习生',
      jobDesc: '开发系统。<br>编写测试。',
      positionWorkCity: '成都',
      positionWorkingExp: '',
      salary60: '面议',
      education: '本科',
    },
    companyDetail: { companyNumber: 'KA_TEST', companyName: '测试企业' },
  },
};
/** 每例独立副本，避免破坏性字段测试污染其他用例。 */
const result = (): typeof fixture => structuredClone(fixture);

it('verifies selected identity and converts only known line-break markup', () => {
  expect(parseZhilianCampusDetail(selection, result())).toMatchObject({
    externalCompanyId: 'KA_TEST',
    description: '开发系统。\n编写测试。',
    sourceUrl: 'https://xiaoyuan.zhaopin.com/job/CC_TEST',
  });
});

it('preserves paragraphs and ordered lists used by the formerly rejected detail', () => {
  const raw = result();
  raw.data.positionDetail.jobDesc =
    '<p>岗位职责</p><ol> <li>开发接口。</li> <li>编写测试。</li></ol>基本要求<ol><li>熟悉 Java。</li></ol><p><br></p><p>团队协作。<br></p>';
  expect(parseZhilianCampusDetail(selection, raw).description).toBe(
    '岗位职责\n1. 开发接口。\n2. 编写测试。\n基本要求\n1. 熟悉 Java。\n团队协作。',
  );
});

it('keeps comparison symbols in ordinary text', () => {
  const raw = result();
  raw.data.positionDetail.jobDesc = '性能 > 100，延迟 < 5。';
  expect(parseZhilianCampusDetail(selection, raw).description).toBe('性能 > 100，延迟 < 5。');
});

it.each([
  '<p onclick="run()">正文</p>',
  '<ol><li>正文</ol>',
  '<li>正文</li>',
  '<p>未闭合',
  '<p>&unknown;</p>',
  '<p><br></p>',
])('rejects unsupported or malformed markup: %s', (description) => {
  const raw = result();
  raw.data.positionDetail.jobDesc = description;
  expect(() => parseZhilianCampusDetail(selection, raw)).toThrow('parse_changed');
});

it.each(['positionNumber', 'positionName', 'jobDesc'] as const)(
  'rejects incompatible position field %s',
  (field) => {
    const raw = result();
    raw.data.positionDetail[field] = '';
    expect(() => parseZhilianCampusDetail(selection, raw)).toThrow('parse_changed');
  },
);

it('rejects company mismatch and unknown HTML instead of silently rewriting', () => {
  const raw = result();
  raw.data.companyDetail.companyName = '其他公司';
  expect(() => parseZhilianCampusDetail(selection, raw)).toThrow('parse_changed');
  raw.data.companyDetail.companyName = selection.company;
  raw.data.positionDetail.jobDesc = '<script>alert(1)</script>';
  expect(() => parseZhilianCampusDetail(selection, raw)).toThrow('parse_changed');
});

it.each([
  [2024, 'access_blocked'],
  [210, 'upstream_error'],
] as const)('classifies business code %s without exposing raw errors', (statusCode, category) => {
  expect(() =>
    parseZhilianCampusDetail(selection, { statusCode, statusDescription: 'private secret' }),
  ).toThrow(category);
});

it('reads one selected detail once and releases credentials without claiming pagination', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(result())));
  const session = new ZhilianCampusSelectionSession({
    selection,
    auth: { at: 'private-at', rt: 'private-rt', d: 'private-d' },
    fetch: fetcher,
  });
  const signal = new AbortController().signal;
  const batch = await session.readNext(signal);
  expect(batch.candidates).toHaveLength(1);
  expect(batch.hasMore).toBe(false);
  expect(JSON.stringify(batch)).not.toContain('private-');
  expect(await session.readNext(signal)).toEqual({ candidates: [], hasMore: false });
  expect((await session.readDetail('CC_TEST', signal)).description).toContain('\n');
  expect(fetcher).toHaveBeenCalledTimes(1);
  const call = fetcher.mock.calls[0];
  if (!call) throw new Error('Expected one request');
  const [url, init] = call;
  expect(url).toBe('https://cgate.zhaopin.com/positionbusiness/exposure/getPositionDetail');
  expect(init?.redirect).toBe('manual');
  expect(new Headers(init?.headers).has('Cookie')).toBe(false);
  await expect(session.readDetail('other', signal)).rejects.toThrow('session_unavailable');
  session.disconnect();
  await expect(session.readDetail('CC_TEST', signal)).rejects.toThrow('session_unavailable');
});

it.each([
  new Response('<script>verification</script>'),
  new Response('blocked', { status: 403 }),
  new Response('slow', { status: 429 }),
  new Response('redirect', { status: 302 }),
  new Response('x'.repeat(2 * 1024 * 1024 + 1)),
])('freezes after invalid transport without retrying', async (response) => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
  const session = new ZhilianCampusSelectionSession({
    selection,
    auth: { at: 'a', rt: 'r', d: 'd' },
    fetch: fetcher,
  });
  await expect(session.readNext(new AbortController().signal)).rejects.toThrow();
  await expect(session.readNext(new AbortController().signal)).rejects.toThrow(
    'session_unavailable',
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
});
