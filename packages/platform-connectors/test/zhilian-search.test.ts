import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { ZhilianSearchHttpSession, type ZhilianSearchTemplates } from '../src/index.js';

const fixture = JSON.parse(
  readFileSync(new URL('../../../fixtures/platforms/zhilian-search.json', import.meta.url), 'utf8'),
) as {
  templates: ZhilianSearchTemplates;
  row: {
    number: string;
    name: string;
    companyNumber: string;
    companyName: string;
    workCity: string;
    salary60: string;
    education: string;
    workingExp: string;
  };
  detail: {
    code: number;
    apiCode: number;
    data: {
      detailedPosition: { positionNumber: string; positionName: string; jobDesc: string };
      detailedCompany: { companyNumber: string; companyName: string };
    };
  };
};
const signal = new AbortController().signal;
/** 合成结果使用相同协议，不包含真实个人令牌。 */
function batch(
  rows = [fixture.row],
  end = 1,
): {
  code: number;
  apiCode: number;
  data: {
    statusCode: number;
    isVerification: number;
    count: number;
    isEndPage: number;
    list: (typeof fixture.row)[];
  };
} {
  return {
    code: 200,
    apiCode: 200,
    data: { statusCode: 200, isVerification: 0, count: 40, isEndPage: end, list: rows },
  };
}
/** 递增时钟仅用于离线测试，生产默认仍真实等待 5 秒。 */
function setup(responses: unknown[]): {
  fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
  session: ZhilianSearchHttpSession;
} {
  let now = 0;
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(() => Promise.resolve(Response.json(responses.shift())));
  return {
    fetcher,
    session: new ZhilianSearchHttpSession({
      templates: fixture.templates,
      fetch: fetcher,
      now: () => (now += 5001),
    }),
  };
}
afterEach(() => vi.useRealTimers());

it('keeps the session after a Worker finishes its first task and honors the next delay', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json(batch([fixture.row], 0)))
    .mockResolvedValueOnce(Response.json(batch([{ ...fixture.row, number: 'NEXT' }])));
  const session = new ZhilianSearchHttpSession({ templates: fixture.templates, fetch: fetcher });
  const first = new AbortController();
  await session.readNext(first.signal);
  first.abort('finished');
  const started = Date.now();
  const next = session.readNext(new AbortController().signal);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect((await next).candidates[0]?.externalJobId).toBe('NEXT');
  expect(Date.now() - started).toBeGreaterThanOrEqual(4900);
  expect(fetcher).toHaveBeenCalledTimes(2);
}, 10000);

it('preserves search filters across pages and requests independent verified detail', async () => {
  const second = { ...fixture.row, number: 'CC_NEXT' };
  const { session, fetcher } = setup([batch([fixture.row], 0), batch([second]), fixture.detail]);
  expect((await session.readNext(signal)).hasMore).toBe(true);
  expect((await session.readNext(signal)).candidates[0]?.externalJobId).toBe('CC_NEXT');
  expect(await session.readDetail('CC_TEST', signal)).toMatchObject({
    description: '负责研发。\n完成测试。',
    sourceUrl: 'https://www.zhaopin.com/jobdetail/CC_TEST.htm',
  });
  for (let i = 0; i < 2; i++) {
    const sentBody = fetcher.mock.calls[i]?.[1]?.body;
    if (typeof sentBody !== 'string') throw new Error('Missing JSON body');
    expect(JSON.parse(sentBody)).toMatchObject({
      S_SOU_FULL_INDEX: 'Java',
      S_SOU_WORK_CITY: '801',
      S_SOU_WORK_EXPERIENCE: '0305',
      pageIndex: i + 1,
    });
    expect(fetcher.mock.calls[i]?.[0]).toBe(fixture.templates.list.url);
    expect(new Headers(fetcher.mock.calls[i]?.[1]?.headers).has('cookie')).toBe(false);
  }
  expect(fetcher.mock.calls[2]?.[1]?.method).toBe('GET');
  const sentUrl = fetcher.mock.calls[2]?.[0];
  if (typeof sentUrl !== 'string') throw new Error('Missing URL');
  expect(new URL(sentUrl).searchParams.get('number')).toBe('CC_TEST');
  expect(await session.readNext(signal)).toEqual({ candidates: [], hasMore: false });
  expect(fetcher).toHaveBeenCalledTimes(3);
});
it.each([
  'foreign',
  'unknown-query',
  'auth-mismatch',
  'unknown-body',
  'wrong-platform',
  'header-injection',
  'wrong-detail',
] as const)('rejects %s templates', (kind) => {
  const t = structuredClone(fixture.templates);
  let list = { ...t.list };
  let detail = { ...t.detail };
  if (kind === 'foreign')
    list = { ...list, url: list.url.replace('fe-api.zhaopin.com', 'evil.example') };
  if (kind === 'unknown-query') list = { ...list, url: list.url + '&unknown=value' };
  if (kind === 'auth-mismatch')
    detail = { ...detail, url: detail.url.replace('at=fixture-at', 'at=other') };
  if (kind === 'unknown-body')
    list = { ...list, body: JSON.stringify({ ...JSON.parse(list.body), unreviewed: 'x' }) };
  if (kind === 'wrong-platform')
    list = { ...list, headers: { ...list.headers, 'x-zp-platform': '14' } };
  if (kind === 'header-injection')
    list = { ...list, headers: { ...list.headers, Accept: 'a\r\nb' } };
  if (kind === 'wrong-detail')
    detail = { ...detail, url: detail.url.replace('position-detailv3', 'send-message') };
  expect(() => new ZhilianSearchHttpSession({ templates: { list, detail } })).toThrow(
    'parse_changed',
  );
});
it.each(['duplicate', 'empty', 'verification', 'business', 'malformed', 'count'] as const)(
  'freezes on %s list',
  async (kind) => {
    const raw = batch();
    if (kind === 'duplicate') raw.data.list = [fixture.row, fixture.row];
    if (kind === 'empty') {
      raw.data.list = [];
      raw.data.isEndPage = 0;
    }
    if (kind === 'verification') raw.data.isVerification = 1;
    if (kind === 'business') raw.code = 210;
    if (kind === 'malformed') raw.data.list = [{ ...fixture.row, number: '' }];
    if (kind === 'count') raw.data.count = 0;
    const { session, fetcher } = setup([raw]);
    await expect(session.readNext(signal)).rejects.toThrow();
    await expect(session.readNext(signal)).rejects.toThrow('session_unavailable');
    expect(fetcher).toHaveBeenCalledTimes(1);
  },
);
it('counts missing company IDs, deduplicates overlap and rejects fully repeated pages', async () => {
  const a = { ...fixture.row, number: 'A', companyNumber: '' },
    b = { ...fixture.row, number: 'B' };
  const { session } = setup([
    batch([a, fixture.row], 0),
    batch([fixture.row, b], 0),
    batch([a, b], 0),
  ]);
  expect(await session.readNext(signal)).toMatchObject({
    skippedMissingCompanyId: 1,
    candidates: [{ externalJobId: 'CC_TEST' }],
  });
  expect((await session.readNext(signal)).candidates).toEqual([
    expect.objectContaining({ externalJobId: 'B' }),
  ]);
  await expect(session.readNext(signal)).rejects.toThrow('parse_changed');
});
it.each(['job', 'title', 'company', 'name', 'html', 'empty', 'malformed-html'] as const)(
  'rejects %s detail mismatch',
  async (kind) => {
    const raw = structuredClone(fixture.detail);
    if (kind === 'job') raw.data.detailedPosition.positionNumber = 'other';
    if (kind === 'title') raw.data.detailedPosition.positionName = 'other';
    if (kind === 'company') raw.data.detailedCompany.companyNumber = 'other';
    if (kind === 'name') raw.data.detailedCompany.companyName = 'other';
    if (kind === 'html') raw.data.detailedPosition.jobDesc = '<div onclick="bad()">text</div>';
    if (kind === 'empty') raw.data.detailedPosition.jobDesc = '<div><br></div>';
    if (kind === 'malformed-html') raw.data.detailedPosition.jobDesc = '<div>text';
    const { session } = setup([batch(), raw]);
    await session.readNext(signal);
    await expect(session.readDetail('CC_TEST', signal)).rejects.toThrow('parse_changed');
  },
);
it('rejects undiscovered detail without upstream IO', async () => {
  const { session, fetcher } = setup([]);
  await expect(session.readDetail('unknown', signal)).rejects.toThrow('session_unavailable');
  expect(fetcher).not.toHaveBeenCalled();
});
it.each([302, 403, 429, 500])('never retries HTTP %s', async (status) => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status }));
  const session = new ZhilianSearchHttpSession({ templates: fixture.templates, fetch: fetcher });
  await expect(session.readNext(signal)).rejects.toThrow(
    status === 429 ? 'rate_limited' : status === 403 ? 'access_blocked' : 'upstream_error',
  );
  expect(fetcher.mock.calls[0]?.[1]?.redirect).toBe('manual');
  await expect(session.readNext(signal)).rejects.toThrow('session_unavailable');
});
it.each(['html', 'oversized', 'broken-json'])('rejects %s without fallback', async (mode) => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(mode === 'oversized' ? 'x'.repeat(2 * 1024 * 1024 + 1) : '<html>', {
      headers: { 'content-type': mode === 'html' ? 'text/html' : 'application/json' },
    }),
  );
  const session = new ZhilianSearchHttpSession({ templates: fixture.templates, fetch: fetcher });
  await expect(session.readNext(signal)).rejects.toThrow('parse_changed');
});
it('waits five seconds and cancels queued work without extra request', async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(batch([fixture.row], 0)));
  const session = new ZhilianSearchHttpSession({ templates: fixture.templates, fetch: fetcher });
  await session.readNext(signal);
  const controller = new AbortController();
  const pending = session.readDetail('CC_TEST', controller.signal);
  const rejected = expect(pending).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(4999);
  expect(fetcher).toHaveBeenCalledTimes(1);
  controller.abort();
  await rejected;
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('distinguishes twenty-page cap from a true end', async () => {
  const { session, fetcher } = setup(
    Array.from({ length: 20 }, (_, i) =>
      batch([{ ...fixture.row, number: `JOB_${String(i)}` }], 0),
    ),
  );
  for (let i = 0; i < 20; i++) expect((await session.readNext(signal)).hasMore).toBe(true);
  await expect(session.readNext(signal)).rejects.toThrow('session_unavailable');
  expect(fetcher).toHaveBeenCalledTimes(20);
});
