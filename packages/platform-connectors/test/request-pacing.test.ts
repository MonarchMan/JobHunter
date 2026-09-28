import { expect, it } from 'vitest';
import { PlatformRequestPacer } from '../src/request-pacing.js';

it('默认零间隔无需推进时钟即可连续执行', async () => {
  const pacer = new PlatformRequestPacer(0, () => 0);
  await pacer.before();
  await pacer.before();
});

it('同会话连续请求受限，不同会话互不阻塞', async () => {
  const one = new PlatformRequestPacer(50),
    two = new PlatformRequestPacer(50);
  await one.before();
  const start = Date.now();
  let finished = false;
  const next = one.before().then(() => {
    finished = true;
  });
  await two.before();
  expect(finished).toBe(false);
  await next;
  expect(Date.now() - start).toBeGreaterThanOrEqual(50);
});

it('取消等待立即失败，不消耗新配额', async () => {
  const pacer = new PlatformRequestPacer(50);
  await pacer.before();
  const abort = new AbortController();
  const pending = pacer.before(abort.signal);
  abort.abort();
  await expect(pending).rejects.toBeDefined();
  await pacer.before();
});

it('同时等待的请求在唤醒后重新检查，不穿透间隔', async () => {
  const pacer = new PlatformRequestPacer(30),
    starts: number[] = [];
  await pacer.before();
  await Promise.all(
    [1, 2].map(async () => {
      await pacer.before();
      starts.push(Date.now());
    }),
  );
  expect((starts[1] ?? 0) - (starts[0] ?? 0)).toBeGreaterThanOrEqual(30);
  await expect(pacer.before(AbortSignal.abort())).rejects.toBeDefined();
});

it.each([-1, 1.5, 60001, NaN, Infinity])('拒绝非法间隔 %s', (value) => {
  expect(() => new PlatformRequestPacer(value)).toThrow();
});
