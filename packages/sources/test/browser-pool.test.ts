import { SourceError, type SourcePageClient } from '@jobhunter/source-core';
import { describe, expect, it } from 'vitest';
import {
  BrowserPool,
  createPooledSourcePageClient,
  type BrowserSession,
  type BrowserSessionFactory,
} from '../src/index.js';

/** 构造测试输入或执行断言的辅助逻辑。 */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

/** 构造测试输入或执行断言的辅助逻辑。 */
function factoryFor(
  onCreate: (sourceKey: string) => void,
  onClose: () => void,
  page = {},
): BrowserSessionFactory<typeof page> {
  return {
    create(input): Promise<BrowserSession<typeof page>> {
      onCreate(input.sourceKey);
      const session: BrowserSession<typeof page> = {
        page,
        close(): Promise<void> {
          onClose();
          return Promise.resolve();
        },
      };
      return Promise.resolve(session);
    },
  };
}

describe('BrowserPool', () => {
  it('limits concurrency and always closes isolated sessions', async () => {
    let active = 0;
    let peak = 0;
    let created = 0;
    let closed = 0;
    const factory: BrowserSessionFactory<number> = {
      create(): Promise<BrowserSession<number>> {
        const page = ++created;
        active += 1;
        peak = Math.max(peak, active);
        const session: BrowserSession<number> = {
          page,
          close(): Promise<void> {
            active -= 1;
            closed += 1;
            return Promise.resolve();
          },
        };
        return Promise.resolve(session);
      },
    };
    const pool = new BrowserPool(factory, { maxConcurrency: 2, defaultTimeoutMs: 1_000 });
    const signal = new AbortController().signal;
    const results = await Promise.all(
      [1, 2, 3, 4].map((value) =>
        pool.execute({
          sourceKey: 'demo',
          requestId: `request-${String(value)}`,
          signal,
          execute: async (page) => {
            await new Promise((resolve) => setTimeout(resolve, 5));
            return page;
          },
        }),
      ),
    );

    expect(results).toEqual([1, 2, 3, 4]);
    expect(peak).toBe(2);
    expect(active).toBe(0);
    expect(created).toBe(4);
    expect(closed).toBe(4);
  });

  it('cancels queued work without opening a session', async () => {
    const first = deferred();
    let created = 0;
    const pool = new BrowserPool(
      factoryFor(
        () => {
          created += 1;
        },
        () => undefined,
      ),
      { maxConcurrency: 1, defaultTimeoutMs: 1_000 },
    );
    const firstController = new AbortController();
    const secondController = new AbortController();
    const running = pool.execute({
      sourceKey: 'demo',
      requestId: 'running',
      signal: firstController.signal,
      execute: async () => {
        await first.promise;
        return 'first';
      },
    });
    while (pool.activeCount !== 1) await new Promise((resolve) => setTimeout(resolve, 0));
    const queued = pool.execute({
      sourceKey: 'demo',
      requestId: 'queued',
      signal: secondController.signal,
      execute: () => Promise.resolve('second'),
    });
    secondController.abort();
    await expect(queued).rejects.toMatchObject({ category: 'temporary' });
    expect(pool.queuedCount).toBe(0);
    expect(created).toBe(1);
    first.resolve();
    await expect(running).resolves.toBe('first');
  });

  it('times out work and reclaims the session', async () => {
    let closed = 0;
    const pool = new BrowserPool(
      factoryFor(
        () => undefined,
        () => {
          closed += 1;
        },
      ),
      { defaultTimeoutMs: 20 },
    );
    await expect(
      pool.execute({
        sourceKey: 'demo',
        requestId: 'timeout',
        signal: new AbortController().signal,
        execute: (_page, signal) =>
          new Promise<never>((_resolve, reject) => {
            signal.addEventListener(
              'abort',
              () => {
                reject(new Error('aborted'));
              },
              { once: true },
            );
          }),
      }),
    ).rejects.toMatchObject({ category: 'temporary' });
    expect(closed).toBe(1);
    expect(pool.activeCount).toBe(0);
  });

  it('releases the slot and drains the queue when session creation fails', async () => {
    let attempts = 0;
    const pool = new BrowserPool<number>(
      {
        create(): Promise<BrowserSession<number>> {
          attempts += 1;
          if (attempts === 1) return Promise.reject(new Error('browser unavailable'));
          return Promise.resolve({
            page: 2,
            close: () => Promise.resolve(),
          });
        },
      },
      { maxConcurrency: 1 },
    );
    const signal = new AbortController().signal;
    const failed = pool.execute({
      sourceKey: 'demo',
      requestId: 'create-fails',
      signal,
      execute: () => Promise.resolve(1),
    });
    const recovered = pool.execute({
      sourceKey: 'demo',
      requestId: 'create-recovers',
      signal,
      execute: (page) => Promise.resolve(page),
    });

    await expect(failed).rejects.toMatchObject({ category: 'temporary' });
    await expect(recovered).resolves.toBe(2);
    expect(pool.activeCount).toBe(0);
    expect(pool.queuedCount).toBe(0);
  });

  it('drains the queue when session cleanup fails', async () => {
    let attempts = 0;
    let closed = 0;
    const pool = new BrowserPool<number>(
      {
        create(): Promise<BrowserSession<number>> {
          const page = ++attempts;
          return Promise.resolve({
            page,
            close: () => {
              closed += 1;
              return page === 1 ? Promise.reject(new Error('cleanup failed')) : Promise.resolve();
            },
          });
        },
      },
      { maxConcurrency: 1 },
    );
    const signal = new AbortController().signal;
    const failed = pool.execute({
      sourceKey: 'demo',
      requestId: 'cleanup-fails',
      signal,
      execute: (page) => Promise.resolve(page),
    });
    const recovered = pool.execute({
      sourceKey: 'demo',
      requestId: 'cleanup-recovers',
      signal,
      execute: (page) => Promise.resolve(page),
    });

    await expect(failed).rejects.toMatchObject({ category: 'temporary' });
    await expect(recovered).resolves.toBe(2);
    expect(closed).toBe(2);
    expect(pool.activeCount).toBe(0);
    expect(pool.queuedCount).toBe(0);
  });

  it('opens a per-source circuit and preserves access errors', async () => {
    let created = 0;
    let now = 0;
    const pool = new BrowserPool(
      factoryFor(
        () => {
          created += 1;
        },
        () => undefined,
      ),
      { failureThreshold: 2, cooldownMs: 100, now: () => now },
    );
    const fail = (sourceKey: string, requestId: string): Promise<never> =>
      pool.execute({
        sourceKey,
        requestId,
        signal: new AbortController().signal,
        execute: () => Promise.reject(new SourceError('access_blocked', 'challenge page')),
      });

    await expect(fail('blocked', 'one')).rejects.toMatchObject({ category: 'access_blocked' });
    await expect(fail('blocked', 'two')).rejects.toMatchObject({ category: 'access_blocked' });
    await expect(fail('blocked', 'three')).rejects.toMatchObject({ category: 'temporary' });
    expect(created).toBe(2);
    await expect(
      pool.execute({
        sourceKey: 'other',
        requestId: 'other',
        signal: new AbortController().signal,
        execute: () => Promise.resolve('healthy'),
      }),
    ).resolves.toBe('healthy');
    now = 101;
    await expect(
      pool.execute({
        sourceKey: 'blocked',
        requestId: 'after-cooldown',
        signal: new AbortController().signal,
        execute: () => Promise.resolve('recovered'),
      }),
    ).resolves.toBe('recovered');
    expect(created).toBe(4);
  });

  it('adapts pooled pages to the neutral source contract', async () => {
    const factory: BrowserSessionFactory<SourcePageClient> = {
      create(): Promise<BrowserSession<SourcePageClient>> {
        const session: BrowserSession<SourcePageClient> = {
          page: {
            snapshot(request) {
              return Promise.resolve({
                url: request.url,
                html: '<main>fixture</main>',
                capturedAt: 1,
              });
            },
          },
          close(): Promise<void> {
            return Promise.resolve();
          },
        };
        return Promise.resolve(session);
      },
    };
    const pageClient = createPooledSourcePageClient(new BrowserPool(factory));
    await expect(
      pageClient.snapshot({
        sourceKey: 'demo',
        requestId: 'snapshot',
        url: 'https://jobs.example.test/positions',
        allowedHosts: ['jobs.example.test'],
        signal: new AbortController().signal,
        timeoutMs: 100,
        maximumResponseBytes: 10_000,
      }),
    ).resolves.toEqual({
      url: 'https://jobs.example.test/positions',
      html: '<main>fixture</main>',
      capturedAt: 1,
    });
  });
});
