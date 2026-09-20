import { afterEach, expect, it, vi } from 'vitest';
import { Job51HttpSession, type Job51RequestTemplate } from '../src/job51.js';
import { Job51RequestObserver } from '../src/job51-observer.js';

/** 脱敏合成模板，不包含真实账号、Cookie 或签名。 */
function template(page = 1): Job51RequestTemplate {
  return {
    url: `https://we.51job.com/api/job/search-pc?api_key=51job&pageSize=20&pageNum=${String(page)}&keyword=Java&decode__1048=fixture`,
    headers: { accept: 'application/json', cookie: 'test=fixture', sign: 'fixture' },
  };
}
/** 只构造用于职位边界的字段，其余平台个人字段不得进入投影。 */
function row(id = '100'): Record<string, string> {
  return {
    jobId: id,
    coId: '200',
    jobName: '开发工程师',
    companyName: '测试公司',
    jobAreaString: '上海',
    provideSalaryString: '1-2万',
    workYearString: '1年',
    degreeString: '本科',
    jobHref: `https://jobs.51job.com/shanghai/${id}.html?req=private`,
    jobDescribe: '工作职责：开发与维护系统。\n任职要求：熟悉 Java。',
    hrName: '不应持久化',
  };
}
/** 合成一页 JSON，末页判据来自官网总数而非本地安全上限。 */
function response(items = [row()], totalCount = 1): Response {
  return Response.json({ status: '1', resultbody: { job: { items, totalCount } } });
}
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('fetches the exact observed URL and consumes full JSON detail without another HTTP', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response());
  const s = new Job51HttpSession({ fetch: fetcher });
  s.offer(template());
  expect(fetcher).not.toHaveBeenCalled();
  const batch = await s.readNext(new AbortController().signal);
  expect(batch).toMatchObject({ hasMore: false, skippedMissingCompanyId: 0 });
  expect(batch.candidates[0]).not.toHaveProperty('description');
  expect(batch.candidates[0]?.sourceUrl).toBe('https://jobs.51job.com/shanghai/100.html');
  expect(await s.readDetail('100', new AbortController().signal)).toMatchObject({
    description: row().jobDescribe,
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0]?.[0]).toBe(template().url);
  expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ redirect: 'manual' });
  expect(await s.readNext(new AbortController().signal)).toEqual({
    candidates: [],
    hasMore: false,
  });
});

it('reads observed first and last pages with a five-second gap and no invented signature', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      response(
        Array.from({ length: 20 }, (_, i) => row(String(100 + i))),
        42,
      ),
    )
    .mockResolvedValueOnce(response([row('140'), row('141')], 42));
  const s = new Job51HttpSession({ fetch: fetcher });
  s.offer(template());
  expect((await s.readNext(new AbortController().signal)).hasMore).toBe(true);
  s.offer(template(3));
  const started = Date.now();
  const pending = s.readNext(new AbortController().signal);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect((await pending).hasMore).toBe(false);
  expect(Date.now() - started).toBeGreaterThanOrEqual(4900);
  expect(fetcher.mock.calls[1]?.[0]).toBe(template(3).url);
}, 10_000);

it.each([
  [
    'cross origin',
    () => ({ ...template(), url: template().url.replace('we.51job.com', 'evil.test') }),
  ],
  ['unknown query', () => ({ ...template(), url: template().url + '&unknown=1' })],
  ['duplicate page', () => ({ ...template(), url: template().url + '&pageNum=1' })],
  ['header injection', () => ({ ...template(), headers: { cookie: 'a\r\nb' } })],
] as const)('rejects %s before HTTP', async (_name, build) => {
  const fetcher = vi.fn<typeof fetch>();
  const s = new Job51HttpSession({ fetch: fetcher });
  s.offer(build());
  await expect(s.readNext(new AbortController().signal)).rejects.toMatchObject({
    category: 'parse_changed',
  });
  expect(fetcher).not.toHaveBeenCalled();
});

it.each([
  ['empty nonterminal', () => response([], 20)],
  ['short nonterminal', () => response([row()], 40)],
  ['duplicate ids', () => response([row(), row()], 2)],
  ['missing description', () => response([{ ...row(), jobDescribe: '' }])],
  ['foreign detail', () => response([{ ...row(), jobHref: 'https://evil.test/100.html' }])],
  [
    'mismatched identity',
    () => response([{ ...row(), jobHref: 'https://jobs.51job.com/shanghai/999.html' }]),
  ],
] as const)('freezes %s and never retries', async (_name, build) => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(build());
  const s = new Job51HttpSession({ fetch: fetcher });
  s.offer(template());
  await expect(s.readNext(new AbortController().signal)).rejects.toMatchObject({
    category: 'parse_changed',
  });
  s.offer(template(2));
  await expect(s.readNext(new AbortController().signal)).rejects.toBeInstanceOf(Error);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it.each([
  [403, 'access_blocked'],
  [429, 'rate_limited'],
  [500, 'upstream_error'],
] as const)('classifies HTTP %s', async (status, category) => {
  const s = new Job51HttpSession({
    fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status })),
  });
  s.offer(template());
  await expect(s.readNext(new AbortController().signal)).rejects.toMatchObject({ category });
});

it('counts known missing company identities without fabricating IDs', async () => {
  const s = new Job51HttpSession({
    fetch: vi.fn<typeof fetch>().mockResolvedValue(response([{ ...row(), coId: '' }])),
  });
  s.offer(template());
  expect(await s.readNext(new AbortController().signal)).toEqual({
    candidates: [],
    hasMore: false,
    skippedMissingCompanyId: 1,
  });
});

it.each([
  ['content_type', () => new Response('<html>private-secret</html>')],
  ['missing_body', () => new Response(null, { headers: { 'content-type': 'application/json' } })],
  [
    'body_limit',
    () =>
      new Response('x'.repeat(2 * 1024 * 1024 + 1), {
        headers: { 'content-type': 'application/json' },
      }),
  ],
  [
    'json',
    () => new Response('private-secret', { headers: { 'content-type': 'application/json' } }),
  ],
  ['envelope', () => Response.json({ status: 1, secret: 'private-secret' })],
  ['job_schema', () => response([{ ...row(), jobDescribe: '' }])],
  ['pagination', () => response([row()], 40)],
  ['detail_url', () => response([{ ...row(), jobHref: 'private-secret' }])],
] as const)(
  'reports only a fixed %s stage and freezes without retaining response values',
  async (stage, build) => {
    // 1、各失败分支必须保留 parse_changed 类别，不导出响应或校验库原文。
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(build());
    const session = new Job51HttpSession({ fetch: fetcher });
    session.offer(template());
    const expected = {
      category: 'parse_changed',
      stage,
      message: `Platform request failed: parse_changed [51job:${stage}]`,
    };
    await expect(session.readNext(new AbortController().signal)).rejects.toMatchObject(expected);
    // 2、失败后新模板不能恢复采集，避免诊断触发重试。
    session.offer(template(2));
    await expect(session.readNext(new AbortController().signal)).rejects.toMatchObject(expected);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(session.active).toBe(false);
  },
);

it('separates query changes from malformed request templates without leaking either value', async () => {
  // 1、查询变化有独立阶段，消息不含新旧查询值。
  const session = new Job51HttpSession();
  session.offer(template());
  session.offer({ ...template(2), url: template(2).url.replace('Java', 'private-secret') });
  await expect(session.readNext(new AbortController().signal)).rejects.toMatchObject({
    category: 'parse_changed',
    stage: 'query_changed',
    message: 'Platform request failed: parse_changed [51job:query_changed]',
  });
  // 2、未知模板字段仍拒绝，不因为增加诊断而扩大允许请求范围。
  const invalid = new Job51HttpSession();
  invalid.offer({ ...template(), url: template().url + '&unknown=private-secret' });
  await expect(invalid.readNext(new AbortController().signal)).rejects.toMatchObject({
    category: 'parse_changed',
    stage: 'request_template',
    message: 'Platform request failed: parse_changed [51job:request_template]',
  });
});

it('rejects query changes and never reads an unselected detail', async () => {
  const s = new Job51HttpSession();
  s.offer(template());
  s.offer({ ...template(2), url: template(2).url.replace('Java', 'Python') });
  expect(s.active).toBe(false);
  await expect(s.readDetail('100', new AbortController().signal)).rejects.toMatchObject({
    category: 'parse_changed',
  });
});

it('cancels waiting for a new browser batch without an upstream request', async () => {
  const fetcher = vi.fn<typeof fetch>();
  const s = new Job51HttpSession({ fetch: fetcher });
  const controller = new AbortController();
  const pending = s.readNext(controller.signal);
  const rejected = expect(pending).rejects.toMatchObject({ category: 'session_unavailable' });
  controller.abort();
  await rejected;
  expect(fetcher).not.toHaveBeenCalled();
  expect(s.active).toBe(false);
});

it('observes only the selected successful search request and clears on detachment', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response());
  const s = new Job51HttpSession({ fetch: fetcher });
  const observer = new Job51RequestObserver('selected', s);
  const emit = (method: string, params: Record<string, unknown>, sessionId = 'selected'): void => {
    observer.accept({ method, params, sessionId });
  };
  emit(
    'Network.requestWillBeSent',
    { requestId: 'ignored', request: { url: template().url, method: 'GET', headers: {} } },
    'other',
  );
  emit('Network.requestWillBeSent', { requestId: 'ok', request: { ...template(), method: 'GET' } });
  emit('Network.requestWillBeSentExtraInfo', {
    requestId: 'ok',
    headers: { cookie: 'test=fixture' },
  });
  emit('Network.responseReceived', { requestId: 'ok', response: { status: 200 } });
  expect(fetcher).not.toHaveBeenCalled();
  await s.readNext(new AbortController().signal);
  expect(fetcher).toHaveBeenCalledTimes(1);
  emit('Target.detachedFromTarget', { sessionId: 'selected' }, '');
  expect(s.active).toBe(false);
});
