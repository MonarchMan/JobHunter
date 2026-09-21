import { expect, it } from 'vitest';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  assertBrowserFixture,
  browserFixtureAddress,
  browserFixtureIdentity,
} from '../src/server/browser-test-isolation.js';

const id = '018f0000-0000-7000-8000-000000000001';
it('测试只接受夹具专属端口的 loopback 地址', () => {
  expect(browserFixtureAddress({})).toEqual({ port: '3217', baseURL: 'http://127.0.0.1:3217' });
  for (const value of [
    'https://example.com',
    'http://127.0.0.1:3210',
    'http://localhost:3217',
    'http://127.0.0.1:3217/jobs',
  ])
    expect(() => browserFixtureAddress({ PLAYWRIGHT_BASE_URL: value })).toThrow();
  for (const port of ['0', '80', '99999', '../var'])
    expect(() => browserFixtureAddress({ PLAYWRIGHT_FIXTURE_PORT: port })).toThrow();
});
it('真实数据目录或生产服务即使继承标识也不能冒充隔离夹具', () => {
  const env = {
    JOBHUNTER_BROWSER_TEST_RUN_ID: id,
    JOBHUNTER_DATA_ROOT: path.join(tmpdir(), 'jobhunter-web-browser-test'),
  };
  expect(browserFixtureIdentity(env)).toBe(id);
  expect(browserFixtureIdentity({ ...env, NODE_ENV: 'production' })).toBeNull();
  expect(browserFixtureIdentity({ ...env, JOBHUNTER_DATA_ROOT: path.resolve('var') })).toBeNull();
  expect(browserFixtureIdentity({ ...env, JOBHUNTER_BROWSER_TEST_RUN_ID: 'invalid' })).toBeNull();
});
it('普通服务与旧夹具的只读探测均拒绝，正确身份才放行', () => {
  expect(() => {
    assertBrowserFixture(new Response('{}'), id);
  }).toThrow('identity mismatch');
  expect(() => {
    assertBrowserFixture(new Response('{}', { headers: { 'x-jobhunter-test-run': 'old' } }), id);
  }).toThrow();
  expect(() => {
    assertBrowserFixture(
      new Response(null, { status: 302, headers: { 'x-jobhunter-test-run': id } }),
      id,
    );
  }).toThrow();
  expect(() => {
    assertBrowserFixture(new Response('{}', { headers: { 'x-jobhunter-test-run': id } }), id);
  }).not.toThrow();
});
