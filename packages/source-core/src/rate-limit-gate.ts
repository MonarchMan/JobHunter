import { SourceError } from './errors.js';
import type { SourceRateLimitGate } from './http-client.js';

export interface SourceRateLimitPolicy {
  readonly requestsPerMinute: number;
  readonly burst: number;
}

interface Waiter {
  readonly signal: AbortSignal;
  readonly resolve: () => void;
  readonly reject: (error: SourceError) => void;
  readonly cancel: () => void;
}

interface BucketState {
  tokens: number;
  updatedAt: number;
  readonly queue: Waiter[];
  timer: ReturnType<typeof setTimeout> | null;
}

/** Per-source token buckets with FIFO, cancellation-aware wait queues. */
export class TokenBucketSourceRateLimitGate implements SourceRateLimitGate {
  readonly #policies: ReadonlyMap<string, SourceRateLimitPolicy>;
  readonly #states = new Map<string, BucketState>();
  readonly #now: () => number;

  public constructor(
    policies: ReadonlyMap<string, SourceRateLimitPolicy>,
    options: { readonly now?: () => number } = {},
  ) {
    for (const [sourceKey, policy] of policies) {
      if (!sourceKey.trim()) throw new TypeError('Rate-limit source key must not be empty.');
      if (!Number.isFinite(policy.requestsPerMinute) || policy.requestsPerMinute <= 0) {
        throw new TypeError(`Invalid requests-per-minute for source ${sourceKey}.`);
      }
      if (!Number.isSafeInteger(policy.burst) || policy.burst < 1) {
        throw new TypeError(`Invalid rate-limit burst for source ${sourceKey}.`);
      }
    }
    this.#policies = policies;
    this.#now = options.now ?? Date.now;
  }

  public beforeRequest(input: {
    readonly sourceKey: string;
    readonly signal: AbortSignal;
  }): Promise<void> {
    const policy = this.#policies.get(input.sourceKey);
    if (!policy) return Promise.resolve();
    if (input.signal.aborted) {
      return Promise.reject(
        new SourceError('temporary', 'Source request was cancelled while rate limited.'),
      );
    }

    const state = this.#state(input.sourceKey, policy);
    this.#refill(state, policy);
    if (state.queue.length === 0 && state.tokens >= 1) {
      state.tokens -= 1;
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        signal: input.signal,
        resolve,
        reject,
        cancel: () => {
          const index = state.queue.indexOf(waiter);
          if (index < 0) return;
          state.queue.splice(index, 1);
          input.signal.removeEventListener('abort', waiter.cancel);
          reject(new SourceError('temporary', 'Source request was cancelled while rate limited.'));
          this.#schedule(input.sourceKey, state, policy);
        },
      };
      input.signal.addEventListener('abort', waiter.cancel, { once: true });
      state.queue.push(waiter);
      this.#schedule(input.sourceKey, state, policy);
    });
  }

  public queuedCount(sourceKey?: string): number {
    if (sourceKey) return this.#states.get(sourceKey)?.queue.length ?? 0;
    return [...this.#states.values()].reduce((total, state) => total + state.queue.length, 0);
  }

  #state(sourceKey: string, policy: SourceRateLimitPolicy): BucketState {
    const existing = this.#states.get(sourceKey);
    if (existing) return existing;
    const created: BucketState = {
      tokens: policy.burst,
      updatedAt: this.#now(),
      queue: [],
      timer: null,
    };
    this.#states.set(sourceKey, created);
    return created;
  }

  #refill(state: BucketState, policy: SourceRateLimitPolicy): void {
    const now = this.#now();
    const elapsedMs = Math.max(0, now - state.updatedAt);
    state.tokens = Math.min(
      policy.burst,
      state.tokens + (elapsedMs * policy.requestsPerMinute) / 60_000,
    );
    state.updatedAt = now;
  }

  #schedule(sourceKey: string, state: BucketState, policy: SourceRateLimitPolicy): void {
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    this.#refill(state, policy);
    while (state.tokens >= 1) {
      const waiter = state.queue.shift();
      if (!waiter) return;
      waiter.signal.removeEventListener('abort', waiter.cancel);
      state.tokens -= 1;
      waiter.resolve();
    }
    if (state.queue.length === 0) return;
    const delayMs = Math.max(
      1,
      Math.ceil(((1 - state.tokens) * 60_000) / policy.requestsPerMinute),
    );
    state.timer = setTimeout(() => {
      state.timer = null;
      this.#schedule(sourceKey, state, policy);
    }, delayMs);
    state.timer.unref();
  }
}
