import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BossPageLifecycle } from '../src/boss-page-lifecycle.js';
import type { BossPageState } from '../src/boss-page-state.js';

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
    const c = new AbortController();
    setTimeout(() => {
      c.abort();
    }, ms);
    return c.signal;
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('同源初始化切换代次，锁定后导航取消在途工作并保留首次原因', async () => {
  const lifecycle = new BossPageLifecycle({ allowInitialNavigation: true });
  lifecycle.navigate('https://www.zhipin.com/web/geek/jobs');
  const first = lifecycle.epoch;
  lifecycle.navigate('https://www.zhipin.com/web/geek/jobs?_security_check=fixture');
  expect(lifecycle.epoch).toBe(first + 1);
  expect(() => {
    lifecycle.assertCurrent(first);
  }).toThrow();
  await vi.advanceTimersByTimeAsync(1100);
  expect(await lifecycle.waitReady(new AbortController().signal, { timeoutMs: 1000 })).toBe(
    lifecycle.epoch,
  );
  lifecycle.lock();
  lifecycle.navigate('https://www.zhipin.com/web/geek/jobs');
  expect(lifecycle.signal.aborted).toBe(true);
  lifecycle.disconnect();
  expect(() => {
    lifecycle.assertCurrent();
  }).toThrow(expect.objectContaining({ reason: 'page_navigated' }));
});

it('恢复期间仅允许官网一次安全检查并自然返回职位页', () => {
  const lifecycle = new BossPageLifecycle({ allowInitialNavigation: true });
  lifecycle.navigate('https://www.zhipin.com/web/geek/jobs');
  lifecycle.lock();
  const previous = lifecycle.epoch;
  // 1、仅在本次普通点击期间接受官网自己完成的检查路由与返回。
  lifecycle.beginSessionRenewal();
  lifecycle.navigate('https://www.zhipin.com/web/passport/zp/security.html?opaque=fixture');
  lifecycle.navigate('https://www.zhipin.com/web/geek/jobs');
  expect(lifecycle.epoch).toBe(previous + 2);
  expect(lifecycle.signal.aborted).toBe(false);
  expect(() => {
    lifecycle.assertCurrent(previous);
  }).toThrow();
  // 2、自然返回后不再容许重复进入检查路由。
  lifecycle.endSessionRenewal();
  lifecycle.navigate('https://www.zhipin.com/web/passport/zp/security.html');
  expect(() => {
    lifecycle.assertCurrent();
  }).toThrow(
    expect.objectContaining({ category: 'access_blocked', reason: 'verification_required' }),
  );
});

it('没有恢复授权时进入官网安全检查立即停止', () => {
  const lifecycle = new BossPageLifecycle({ allowInitialNavigation: true });
  lifecycle.navigate('https://www.zhipin.com/web/geek/jobs');
  lifecycle.lock();
  lifecycle.navigate('https://www.zhipin.com/web/passport/zp/security.html');
  expect(() => {
    lifecycle.assertCurrent();
  }).toThrow(
    expect.objectContaining({ category: 'access_blocked', reason: 'verification_required' }),
  );
});

it('恢复期间检查页若持续出现人工验证状态则停止等待', async () => {
  const lifecycle = new BossPageLifecycle({
    allowInitialNavigation: true,
    inspectPage: () => Promise.resolve('verification_required'),
  });
  lifecycle.navigate('https://www.zhipin.com/web/geek/jobs');
  lifecycle.lock();
  lifecycle.beginSessionRenewal();
  lifecycle.navigate('https://www.zhipin.com/web/passport/zp/security.html');
  const blocked = expect(
    lifecycle.waitReady(new AbortController().signal, { timeoutMs: 20_000 }),
  ).rejects.toMatchObject({ category: 'access_blocked', reason: 'verification_required' });
  await vi.advanceTimersByTimeAsync(2_100);
  await blocked;
});

it('锁定后的同路由重载仍使工作集失效', () => {
  const lifecycle = new BossPageLifecycle({ allowInitialNavigation: true });
  lifecycle.navigate('https://www.zhipin.com/web/geek/jobs');
  lifecycle.lock();
  lifecycle.navigate('https://www.zhipin.com/web/geek/jobs');
  expect(() => {
    lifecycle.assertCurrent();
  }).toThrow(expect.objectContaining({ reason: 'page_navigated' }));
});

it('跨文档迟到的就绪探针被丢弃，需要新文档再次就绪', async () => {
  const inspect = vi
    .fn<() => Promise<BossPageState>>()
    .mockImplementationOnce(() => {
      lifecycle.navigate('https://www.zhipin.com/web/geek/jobs');
      return Promise.resolve('verification_required');
    })
    .mockResolvedValue('ready');
  const lifecycle = new BossPageLifecycle({ allowInitialNavigation: true, inspectPage: inspect });
  const pending = lifecycle.waitReady(new AbortController().signal, { timeoutMs: 60000 });
  await vi.advanceTimersByTimeAsync(1100);
  expect(await pending).toBe(1);
  expect(inspect.mock.calls.length).toBeGreaterThanOrEqual(2);
});

it.each(['cancel', 'disconnect', 'cross_origin'] as const)(
  '等待过程中 %s 立即终止',
  async (mode) => {
    const lifecycle = new BossPageLifecycle({
      allowInitialNavigation: true,
      inspectPage: () => Promise.resolve('loading'),
    });
    const caller = new AbortController();
    const assertion = expect(
      lifecycle.waitReady(caller.signal, { timeoutMs: 60000 }),
    ).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(100);
    if (mode === 'cancel') caller.abort();
    else if (mode === 'disconnect') lifecycle.disconnect();
    else lifecycle.navigate('https://example.com');
    await assertion;
  },
);

it('瞬时风险消失不终止，正常页面仍须满足传输的独立就绪条件', async () => {
  const inspect = vi
    .fn<() => Promise<BossPageState>>()
    .mockResolvedValueOnce('verification_required')
    .mockResolvedValue('ready');
  const available = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);
  const lifecycle = new BossPageLifecycle({ allowInitialNavigation: true, inspectPage: inspect });
  const pending = lifecycle.waitReady(new AbortController().signal, {
    timeoutMs: 60000,
    available,
  });
  await vi.advanceTimersByTimeAsync(2100);
  expect(await pending).toBe(0);
  expect(available).toHaveBeenCalledTimes(2);
});
