import {
  SourceError,
  isSourceError,
  type SourcePageClient,
  type SourcePageCollectionRequest,
} from '@jobhunter/source-core';

export interface BrowserSession<TPage> {
  readonly page: TPage;
  close(): Promise<void>;
}

export interface BrowserSessionFactory<TPage> {
  create(input: {
    readonly sourceKey: string;
    readonly requestId: string;
    readonly signal: AbortSignal;
  }): Promise<BrowserSession<TPage>>;
}

export interface BrowserPoolOptions {
  readonly maxConcurrency?: number;
  readonly failureThreshold?: number;
  readonly cooldownMs?: number;
  readonly defaultTimeoutMs?: number;
  readonly now?: () => number;
}

export interface BrowserPoolRequest<TPage, TResult> {
  readonly sourceKey: string;
  readonly requestId: string;
  readonly signal: AbortSignal;
  readonly timeoutMs?: number;
  readonly execute: (page: TPage, signal: AbortSignal) => Promise<TResult>;
}

interface CircuitState {
  failures: number;
  openedAt: number | null;
}

interface QueueItem<TPage, TResult> {
  readonly request: BrowserPoolRequest<TPage, TResult>;
  readonly resolve: (value: TResult | PromiseLike<TResult>) => void;
  readonly reject: (reason?: unknown) => void;
  readonly cancelQueued: () => void;
  state: 'queued' | 'started' | 'settled';
}

const positiveInteger = (value: number | undefined, fallback: number): number => {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1) {
    throw new SourceError('invalid_config', 'Browser pool option must be a positive integer.');
  }
  return resolved;
};

/**
 * Limits optional browser-backed source work without depending on a browser SDK.
 * The process entry point supplies a factory that creates an isolated anonymous session.
 */
export class BrowserPool<TPage> {
  readonly #factory: BrowserSessionFactory<TPage>;
  readonly #maxConcurrency: number;
  readonly #failureThreshold: number;
  readonly #cooldownMs: number;
  readonly #defaultTimeoutMs: number;
  readonly #now: () => number;
  readonly #queue: QueueItem<TPage, unknown>[] = [];
  readonly #circuits = new Map<string, CircuitState>();
  #active = 0;

  public constructor(factory: BrowserSessionFactory<TPage>, options: BrowserPoolOptions = {}) {
    this.#factory = factory;
    this.#maxConcurrency = positiveInteger(options.maxConcurrency, 1);
    this.#failureThreshold = positiveInteger(options.failureThreshold, 3);
    this.#cooldownMs = positiveInteger(options.cooldownMs, 30_000);
    this.#defaultTimeoutMs = positiveInteger(options.defaultTimeoutMs, 30_000);
    this.#now = options.now ?? Date.now;
  }

  public execute<TResult>(request: BrowserPoolRequest<TPage, TResult>): Promise<TResult> {
    try {
      this.#validateRequest(request);
    } catch (error) {
      return Promise.reject(
        error instanceof Error
          ? error
          : new SourceError('invalid_config', 'Browser request is invalid.'),
      );
    }

    return new Promise<TResult>((resolve, reject) => {
      const item: QueueItem<TPage, TResult> = {
        request,
        resolve,
        reject,
        cancelQueued: () => {
          if (item.state !== 'queued') return;
          item.state = 'settled';
          const index = this.#queue.indexOf(item as QueueItem<TPage, unknown>);
          if (index >= 0) this.#queue.splice(index, 1);
          reject(new SourceError('temporary', 'Browser operation was cancelled while queued.'));
        },
        state: 'queued',
      };
      if (request.signal.aborted) {
        item.cancelQueued();
        return;
      }
      request.signal.addEventListener('abort', item.cancelQueued, { once: true });
      this.#queue.push(item as QueueItem<TPage, unknown>);
      this.#drain();
    });
  }

  public get activeCount(): number {
    return this.#active;
  }

  public get queuedCount(): number {
    return this.#queue.length;
  }

  #validateRequest<TResult>(request: BrowserPoolRequest<TPage, TResult>): void {
    if (!request.sourceKey || !request.requestId || typeof request.execute !== 'function') {
      throw new SourceError('invalid_config', 'Browser pool request is invalid.');
    }
    positiveInteger(request.timeoutMs, this.#defaultTimeoutMs);
  }

  #drain(): void {
    while (this.#active < this.#maxConcurrency) {
      const item = this.#queue.shift();
      if (!item) return;
      if (item.state !== 'queued') continue;
      item.state = 'started';
      item.request.signal.removeEventListener('abort', item.cancelQueued);
      this.#active += 1;
      void this.#start(item);
    }
  }

  async #start<TResult>(item: QueueItem<TPage, TResult>): Promise<void> {
    const request = item.request;
    const timeoutMs = request.timeoutMs ?? this.#defaultTimeoutMs;
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = AbortSignal.any([request.signal, timeoutSignal]);
    let operationError: unknown;
    let completed = false;
    let result!: TResult;
    let session: BrowserSession<TPage> | undefined;

    try {
      try {
        this.#assertCircuitClosed(request.sourceKey);
        session = await this.#factory.create({
          sourceKey: request.sourceKey,
          requestId: request.requestId,
          signal,
        });
        if (signal.aborted) {
          throw new SourceError('temporary', 'Browser operation timed out or was cancelled.');
        }
        result = await request.execute(session.page, signal);
        completed = true;
      } catch (error) {
        operationError = this.#normalizeError(error, request.signal, timeoutSignal);
      }

      if (session) {
        try {
          await session.close();
        } catch (error) {
          if (operationError === undefined) {
            operationError = new SourceError('temporary', 'Browser session cleanup failed.', {
              cause: error,
            });
          }
        }
      }

      if (operationError !== undefined) {
        if (!request.signal.aborted) this.#recordFailure(request.sourceKey);
        this.#settle(item, operationError);
      } else if (completed) {
        this.#recordSuccess(request.sourceKey);
        this.#settle(item, undefined, result);
      } else {
        this.#settle(item, new SourceError('temporary', 'Browser operation did not complete.'));
      }
    } finally {
      this.#active -= 1;
      this.#drain();
    }
  }

  #settle<TResult>(item: QueueItem<TPage, TResult>, error: unknown, result?: TResult): void {
    if (item.state === 'settled') return;
    item.state = 'settled';
    if (error !== undefined) item.reject(error);
    else item.resolve(result as TResult);
  }

  #normalizeError(error: unknown, requestSignal: AbortSignal, timeoutSignal: AbortSignal): unknown {
    if (requestSignal.aborted) {
      return new SourceError('temporary', 'Browser operation was cancelled.', { cause: error });
    }
    if (timeoutSignal.aborted) {
      return new SourceError('temporary', 'Browser operation timed out.', { cause: error });
    }
    if (isSourceError(error)) return error;
    return new SourceError('temporary', 'Browser operation failed.', { cause: error });
  }

  #assertCircuitClosed(sourceKey: string): void {
    const state = this.#circuits.get(sourceKey);
    if (state?.openedAt == null) return;
    if (this.#now() - state.openedAt < this.#cooldownMs) {
      throw new SourceError('temporary', `Browser circuit is open for source ${sourceKey}.`);
    }
    state.failures = 0;
    state.openedAt = null;
  }

  #recordFailure(sourceKey: string): void {
    const state = this.#circuits.get(sourceKey) ?? { failures: 0, openedAt: null };
    state.failures += 1;
    if (state.failures >= this.#failureThreshold) state.openedAt = this.#now();
    this.#circuits.set(sourceKey, state);
  }

  #recordSuccess(sourceKey: string): void {
    this.#circuits.delete(sourceKey);
  }
}

/** Adapts the pool to the neutral source contract without exposing browser objects. */
export function createPooledSourcePageClient(
  pool: BrowserPool<SourcePageClient>,
): SourcePageClient {
  const client: SourcePageClient = {
    snapshot: (request) =>
      pool.execute({
        sourceKey: request.sourceKey,
        requestId: request.requestId,
        signal: request.signal,
        timeoutMs: request.timeoutMs,
        execute: (page) => page.snapshot(request),
      }),
    collect: (request: SourcePageCollectionRequest) =>
      pool.execute({
        sourceKey: request.sourceKey,
        requestId: request.requestId,
        signal: request.signal,
        timeoutMs: request.timeoutMs,
        execute: (page) => {
          if (!page.collect) {
            throw new SourceError(
              'access_blocked',
              'Browser session does not support structured collection.',
            );
          }
          return page.collect(request);
        },
      }),
  };
  return client;
}
