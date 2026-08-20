import { utcInstant, type UtcInstant } from '@jobhunter/domain';
import type { RandomSource, TaskErrorCategory } from './model.js';

const REDACTED = '[redacted]';

export function sanitizeTaskErrorSummary(summary: string): string {
  return summary
    .replaceAll(/Bearer\s+[^\s]+/gi, `Bearer ${REDACTED}`)
    .replaceAll(/(api[-_ ]?key|token|password|cookie)\s*[:=]\s*[^\s,;]+/gi, `$1=${REDACTED}`)
    .replaceAll(/[\r\n\t]+/g, ' ')
    .replaceAll(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 240);
}

export class TaskExecutionError extends Error {
  public readonly category: TaskErrorCategory;
  public readonly safeSummary: string;
  public readonly retryAfterAt: UtcInstant | null;

  public constructor(
    category: TaskErrorCategory,
    safeSummary: string,
    options: { readonly retryAfterAt?: UtcInstant; readonly cause?: unknown } = {},
  ) {
    super(sanitizeTaskErrorSummary(safeSummary), { cause: options.cause });
    this.name = 'TaskExecutionError';
    this.category = category;
    this.safeSummary = sanitizeTaskErrorSummary(safeSummary) || 'Task execution failed.';
    this.retryAfterAt = options.retryAfterAt ?? null;
  }
}

export interface RetryDecision {
  readonly retry: boolean;
  readonly availableAt: UtcInstant | null;
}

export interface RetryPolicyOptions {
  readonly baseDelayMs?: number;
  readonly maximumDelayMs?: number;
  readonly jitterRatio?: number;
}

export class RetryPolicy {
  readonly #random: RandomSource;
  readonly #baseDelayMs: number;
  readonly #maximumDelayMs: number;
  readonly #jitterRatio: number;

  public constructor(random: RandomSource, options: RetryPolicyOptions = {}) {
    this.#random = random;
    this.#baseDelayMs = options.baseDelayMs ?? 1_000;
    this.#maximumDelayMs = options.maximumDelayMs ?? 6 * 60 * 60 * 1_000;
    this.#jitterRatio = options.jitterRatio ?? 0.2;
    if (this.#baseDelayMs < 1 || this.#maximumDelayMs < this.#baseDelayMs) {
      throw new TypeError('Retry delay bounds are invalid.');
    }
    if (this.#jitterRatio < 0 || this.#jitterRatio > 1) {
      throw new TypeError('Retry jitter ratio must be between zero and one.');
    }
  }

  public decide(input: {
    readonly category: TaskErrorCategory;
    readonly attemptCount: number;
    readonly maxAttempts: number;
    readonly now: UtcInstant;
    readonly retryAfterAt?: UtcInstant | null;
  }): RetryDecision {
    const retryable =
      input.category === 'rate_limited' ||
      input.category === 'network_temporary' ||
      input.category === 'io_temporary' ||
      input.category === 'upstream_5xx';
    if (!retryable || input.attemptCount >= input.maxAttempts) {
      return { retry: false, availableAt: null };
    }

    const exponent = Math.max(0, input.attemptCount - 1);
    const base = Math.min(this.#maximumDelayMs, this.#baseDelayMs * 2 ** exponent);
    const jitter = base * this.#jitterRatio * (this.#random.next() * 2 - 1);
    const delayed = input.now + Math.max(0, Math.round(base + jitter));
    const availableAt = Math.max(delayed, input.retryAfterAt ?? 0);
    return { retry: true, availableAt: utcInstant(availableAt) };
  }
}

export function classifyTaskError(error: unknown): TaskExecutionError {
  if (error instanceof TaskExecutionError) return error;
  return new TaskExecutionError('permanent', 'Task handler failed.', { cause: error });
}
