import { parseId, utcInstant } from '@jobhunter/domain';
import { describe, expect, it, vi } from 'vitest';
import {
  createSourceSyncTaskHandler,
  HandlerRegistry,
  RetryPolicy,
  sanitizeTaskErrorSummary,
  TaskExecutionError,
  voidTaskOutputSchema,
} from '../src/index.js';

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
          rawStored: 0,
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
            rawStored: 0,
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
