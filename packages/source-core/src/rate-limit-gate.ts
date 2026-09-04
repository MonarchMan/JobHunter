import { SourceError } from './errors.js';
import type { SourceRateLimitGate } from './http-client.js';

/** 来源适配器使用的数据结构或契约。 */
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

/** 来源适配器使用的数据结构或契约。 */
interface BucketState {
  tokens: number;
  updatedAt: number;
  readonly queue: Waiter[];
  timer: ReturnType<typeof setTimeout> | null;
}

/** Per-source token buckets with FIFO, cancellation-aware wait queues. */
/** 带 FIFO 排队和取消支持的来源令牌桶限流器。 */
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

  /** 在来源请求前消耗令牌，必要时排队等待。 */
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

  /** 返回指定来源或全部来源的排队数量。 */
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

  /** 处理来源类内部的辅助逻辑。 */
  #refill(state: BucketState, policy: SourceRateLimitPolicy): void {
    const now = this.#now();
    const elapsedMs = Math.max(0, now - state.updatedAt);
    state.tokens = Math.min(
      policy.burst,
      state.tokens + (elapsedMs * policy.requestsPerMinute) / 60_000,
    );
    state.updatedAt = now;
  }

  /** 处理来源类内部的辅助逻辑。 */
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
