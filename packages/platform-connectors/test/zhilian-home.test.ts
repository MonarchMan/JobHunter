import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { zhilianSessionFromHome } from '../src/zhilian-home.js';

const auth = {
  at: 'fixture-at',
  rt: 'fixture-rt',
  resumeNumber: 'fixture-resume',
  platform: 13,
  version: '0.0.0',
};
const request = {
  method: 'POST',
  url: 'https://fe-api.zhaopin.com/c/i/resume/preview-standardnode?at=fixture-at&rt=fixture-rt&platform=13&version=0.0.0',
  postData: JSON.stringify(auth),
};
const search = { keyword: '研发', city: '765' };
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('首页认证足以构造独立 HTTP 搜索与详情，不复制 Cookie 或普通追踪字段', async () => {
  vi.useFakeTimers();
  const fixture = JSON.parse(
    readFileSync(
      new URL('../../../fixtures/platforms/zhilian-search.json', import.meta.url),
      'utf8',
    ),
  ) as { row: unknown; detail: unknown };
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json({
        code: 200,
        apiCode: 200,
        data: { statusCode: 200, isVerification: 0, count: 1, isEndPage: 1, list: [fixture.row] },
      }),
    )
    .mockResolvedValueOnce(Response.json(fixture.detail));
  vi.stubGlobal('fetch', fetcher);
  const session = zhilianSessionFromHome(request, search);
  if (!session) throw new Error('Missing session');
  const signal = new AbortController().signal;
  expect((await session.readNext(signal)).candidates).toHaveLength(1);
  // 1、只推进离线时钟，不让 node:timers/promises 产生真实等待。
  vi.setSystemTime(Date.now() + 5001);
  const detail = session.readDetail('CC_TEST', signal);
  expect((await detail).description).toContain('负责研发');
  expect(fetcher).toHaveBeenCalledTimes(2);
  const body = fetcher.mock.calls[0]?.[1]?.body;
  expect(typeof body).toBe('string');
  expect(JSON.parse(body as string)).toMatchObject({
    S_SOU_FULL_INDEX: '研发',
    S_SOU_WORK_CITY: '765',
    cvNumber: auth.resumeNumber,
    pageIndex: 1,
    pageSize: 20,
  });
  for (const [, options] of fetcher.mock.calls) {
    const headers = new Headers(options?.headers);
    expect(headers.has('cookie')).toBe(false);
    expect(headers.has('user-agent')).toBe(false);
    expect(headers.has('x-zp-client-id')).toBe(false);
  }
  session.disconnect();
});

it.each([
  'https://evil.test/c/i/resume/preview-standardnode',
  'not-url',
  'https://fe-api.zhaopin.com/c/i/search/positions',
])('忽略非认证请求 %s', (url) => {
  expect(zhilianSessionFromHome({ ...request, url }, search)).toBeUndefined();
});

it.each([
  { ...request, postData: '{}' },
  { ...request, postData: JSON.stringify({ ...auth, rt: 'different-secret' }) },
  { ...request, url: `${request.url}&at=another-secret` },
])('不拼接不完整或不一致的上下文，也不泄漏原文', (input) => {
  try {
    zhilianSessionFromHome(input, search);
    throw new Error('Expected failure');
  } catch (error) {
    expect(error).toMatchObject({
      category: 'session_unavailable',
      reason: 'auth_context_missing',
    });
    expect(String(error)).not.toMatch(/fixture-at|secret|preview-standardnode/);
  }
});
