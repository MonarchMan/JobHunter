import { parseId, utcInstant } from '@jobhunter/domain';
import { SourceError } from '@jobhunter/source-core';
import { describe, expect, it, vi } from 'vitest';
import {
  AsyncSemaphore,
  AsyncSemaphoreCancelledError,
  createSourceJobDetailTaskHandler,
  createSourceSyncTaskHandler,
  HandlerRegistry,
  RetryPolicy,
  sanitizeTaskErrorSummary,
  TaskExecutionError,
  voidTaskOutputSchema,
} from '../src/index.js';

describe('AsyncSemaphore', () => {
  it('enforces a FIFO global limit without blocking and releases permits', async () => {
    const semaphore = new AsyncSemaphore(2);
    const started: number[] = [];
    const releases: (() => void)[] = [];
    const operation = (id: number): Promise<number> =>
      semaphore.run(new AbortController().signal, async () => {
        started.push(id);
        await new Promise<void>((resolve) => releases.push(resolve));
        return id;
      });

    const first = operation(1);
    const second = operation(2);
    const third = operation(3);
    await vi.waitFor(() => {
      expect(started).toEqual([1, 2]);
    });
    expect(semaphore.activeCount).toBe(2);
    expect(semaphore.queuedCount).toBe(1);

    releases[0]?.();
    await expect(first).resolves.toBe(1);
    await vi.waitFor(() => {
      expect(started).toEqual([1, 2, 3]);
    });
    releases[1]?.();
    releases[2]?.();
    await expect(Promise.all([second, third])).resolves.toEqual([2, 3]);
    expect(semaphore.activeCount).toBe(0);
    expect(semaphore.queuedCount).toBe(0);
  });

  it('removes a cancelled waiter without consuming a permit', async () => {
    const semaphore = new AsyncSemaphore(1);
    let releaseFirst: (() => void) | undefined;
    const first = semaphore.run(
      new AbortController().signal,
      () =>
        new Promise<void>((resolve) => {
          releaseFirst = resolve;
        }),
    );
    const waiting = new AbortController();
    const second = semaphore.run(waiting.signal, () => Promise.resolve());
    await vi.waitFor(() => {
      expect(semaphore.queuedCount).toBe(1);
    });

    waiting.abort();
    await expect(second).rejects.toBeInstanceOf(AsyncSemaphoreCancelledError);
    expect(semaphore.queuedCount).toBe(0);
    expect(semaphore.activeCount).toBe(1);
    releaseFirst?.();
    await first;
    expect(semaphore.activeCount).toBe(0);
  });
});

const silentLogger = {
  info(event: string): void {
    void event;
  },
  warn(event: string): void {
    void event;
  },
  error(event: string): void {
    void event;
  },
};

describe('source.sync handler', () => {
  it('validates payloads and delegates a successful run', async () => {
    const sourceId = '018f0000-0000-7000-8000-000000000002';
    const runId = parseId('018f0000-0000-7000-8000-000000000003', 'SyncRun');
    const run = vi.fn(() =>
      Promise.resolve({
        kind: 'completed' as const,
        runId,
        status: 'succeeded' as const,
        coverage: 'complete' as const,
        stats: {
          discovered: 0,
          created: 0,
          unchanged: 0,
          revised: 0,
          restored: 0,
          staled: 0,
          closed: 0,
          isolated: 0,
          followupEnqueued: 0,
        },
      }),
    );
    const handler = createSourceSyncTaskHandler({ run });
    const payload = handler.payloadSchema.parse({ sourceId, trigger: 'manual' });

    expect(handler.concurrencyKey?.(payload)).toBe(`source-sync:${sourceId}`);
    await expect(
      handler.execute(
        {
          signal: new AbortController().signal,
          clock: { now: () => utcInstant(1) },
          logger: silentLogger,
          services: {},
        },
        payload,
      ),
    ).resolves.toEqual({ runId, status: 'succeeded', coverage: 'complete' });
    expect(run).toHaveBeenCalledOnce();
    expect(() =>
      handler.payloadSchema.parse({ sourceId, trigger: 'manual', extra: true }),
    ).toThrow();
  });

  it('classifies a failed synchronization as a permanent task error', async () => {
    const runId = parseId('018f0000-0000-7000-8000-000000000003', 'SyncRun');
    const handler = createSourceSyncTaskHandler({
      run: () =>
        Promise.resolve({
          kind: 'completed',
          runId,
          status: 'failed',
          coverage: 'unknown',
          stats: {
            discovered: 0,
            created: 0,
            unchanged: 0,
            revised: 0,
            restored: 0,
            staled: 0,
            closed: 0,
            isolated: 0,
            followupEnqueued: 0,
          },
        }),
    });

    await expect(
      handler.execute(
        {
          signal: new AbortController().signal,
          clock: { now: () => utcInstant(1) },
          logger: silentLogger,
          services: {},
        },
        { sourceId: '018f0000-0000-7000-8000-000000000002', trigger: 'manual' },
      ),
    ).rejects.toMatchObject({ category: 'permanent' });
  });

  it('retries a partial synchronization when coverage diagnostics are temporary', async () => {
    const runId = parseId('018f0000-0000-7000-8000-000000000003', 'SyncRun');
    const handler = createSourceSyncTaskHandler({
      run: () =>
        Promise.resolve({
          kind: 'completed',
          runId,
          status: 'partial',
          coverage: 'partial',
          stats: {
            discovered: 1,
            created: 1,
            unchanged: 0,
            revised: 0,
            restored: 0,
            staled: 0,
            closed: 0,
            isolated: 0,
            skippedNonDomestic: 0,
            skippedUnknownRegion: 0,
            skippedOutOfScope: 0,
            followupEnqueued: 0,
          },
          errorCategory: 'temporary',
          errorSummary: 'Pagination total changed.',
        }),
    });

    await expect(
      handler.execute(
        {
          signal: new AbortController().signal,
          clock: { now: () => utcInstant(1) },
          logger: silentLogger,
          services: {},
        },
        { sourceId: '018f0000-0000-7000-8000-000000000002', trigger: 'manual' },
      ),
    ).rejects.toMatchObject({ category: 'network_temporary' });
  });
});

describe('HandlerRegistry', () => {
  it('rejects duplicate handlers and classifies output schema failures', async () => {
    const registry = new HandlerRegistry();
    const handler = {
      taskType: 'fixture.task',
      payloadSchema: { parse: (value: unknown) => String(value) },
      outputSchema: {
        parse(value: unknown): string {
          if (typeof value !== 'string') throw new TypeError('Expected string output.');
          return value;
        },
      },
      defaultMaxAttempts: 2,
      leaseDurationMs: 1_000,
      execute: (): Promise<unknown> => Promise.resolve(undefined),
    };
    registry.register(handler);
    expect(() => {
      registry.register(handler);
    }).toThrow(/already registered/);
    await expect(
      registry.execute(
        'fixture.task',
        {
          signal: new AbortController().signal,
          clock: { now: () => utcInstant(1) },
          logger: {
            info(event, fields): void {
              void event;
              void fields;
            },
            warn(event, fields): void {
              void event;
              void fields;
            },
            error(event, fields): void {
              void event;
              void fields;
            },
          },
          services: {},
        },
        'payload',
      ),
    ).rejects.toMatchObject({ category: 'validation_failed' });
  });

  it('provides a strict void output schema', () => {
    voidTaskOutputSchema.parse(undefined);
    expect(() => {
      voidTaskOutputSchema.parse('unexpected');
    }).toThrow();
  });
});

describe('RetryPolicy', () => {
  it('applies exponential backoff, deterministic jitter and the delay cap', () => {
    const policy = new RetryPolicy(
      { next: () => 1 },
      { baseDelayMs: 100, maximumDelayMs: 450, jitterRatio: 0.2 },
    );
    expect(
      policy.decide({
        category: 'network_temporary',
        attemptCount: 3,
        maxAttempts: 5,
        now: utcInstant(1_000),
      }).availableAt,
    ).toBe(1_480);
    expect(
      policy.decide({
        category: 'upstream_5xx',
        attemptCount: 20,
        maxAttempts: 30,
        now: utcInstant(1_000),
      }).availableAt,
    ).toBe(1_540);
    expect(
      policy.decide({
        category: 'io_temporary',
        attemptCount: 1,
        maxAttempts: 3,
        now: utcInstant(1_000),
      }).retry,
    ).toBe(true);
  });

  it('does not retry permanent categories or exhausted tasks', () => {
    const policy = new RetryPolicy({ next: () => 0.5 });
    expect(
      policy.decide({
        category: 'invalid_config',
        attemptCount: 1,
        maxAttempts: 5,
        now: utcInstant(1),
      }),
    ).toEqual({ retry: false, availableAt: null });
    expect(
      policy.decide({
        category: 'rate_limited',
        attemptCount: 5,
        maxAttempts: 5,
        now: utcInstant(1),
      }),
    ).toEqual({ retry: false, availableAt: null });
  });

  it('honors an explicit task-level retry override without changing category defaults', () => {
    const policy = new RetryPolicy({ next: () => 0.5 });
    expect(
      policy.decide({
        category: 'parse_changed',
        attemptCount: 1,
        maxAttempts: 3,
        now: utcInstant(1),
      }).retry,
    ).toBe(false);
    expect(
      policy.decide({
        category: 'parse_changed',
        attemptCount: 1,
        maxAttempts: 3,
        now: utcInstant(1),
        retryable: true,
      }).retry,
    ).toBe(true);
  });

  it('redacts credential-shaped text from safe summaries', () => {
    const summary = sanitizeTaskErrorSummary(
      'request failed\nAuthorization Bearer top-secret token=abc password:xyz',
    );
    expect(summary).not.toContain('top-secret');
    expect(summary).not.toContain('abc');
    expect(summary).not.toContain('xyz');
    expect(new TaskExecutionError('parse_changed', summary).safeSummary.length).toBeLessThanOrEqual(
      240,
    );
  });
});

describe('source.job-detail retry diagnostics', () => {
  it('keeps the parse category and diagnostic while marking it retryable', async () => {
    const handler = createSourceJobDetailTaskHandler({
      run: () =>
        Promise.reject(
          new SourceError(
            'parse_changed',
            'Tencent detail response changed: data.desc is missing.',
          ),
        ),
    });

    await expect(
      handler.execute(
        {
          signal: new AbortController().signal,
          clock: { now: () => utcInstant(1) },
          logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
          services: {},
        },
        {
          sourceId: '018f0000-0000-7000-8000-000000000211',
          runId: '01a06074-96ee-7c4e-a89a-7027d4fc9c13',
          listContentHash: 'a'.repeat(64),
          adapterVersion: '1.0.0',
          discovered: {
            externalJobId: '1231829074692139076',
            sourceUrl: 'https://join.qq.com/post_detail.html?postid=1231829074692139076',
            raw: {},
          },
        },
      ),
    ).rejects.toMatchObject({
      category: 'parse_changed',
      retryable: true,
      safeSummary: 'Tencent detail response changed: data.desc is missing.',
    });
  });
});
