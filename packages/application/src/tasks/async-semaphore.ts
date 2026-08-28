interface QueuedPermit {
  readonly signal: AbortSignal;
  readonly resolve: (release: () => void) => void;
  readonly reject: (error: AsyncSemaphoreCancelledError) => void;
  readonly cancel: () => void;
}

export class AsyncSemaphoreCancelledError extends Error {
  public constructor() {
    super('Semaphore wait was cancelled.');
    this.name = 'AsyncSemaphoreCancelledError';
  }
}

/** FIFO, cancellation-aware semaphore that suspends promises without blocking a thread. */
export class AsyncSemaphore {
  readonly #capacity: number;
  readonly #queue: QueuedPermit[] = [];
  #active = 0;

  public constructor(capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      throw new TypeError('Semaphore capacity must be a positive integer.');
    }
    this.#capacity = capacity;
  }

  public get activeCount(): number {
    return this.#active;
  }

  public get queuedCount(): number {
    return this.#queue.length;
  }

  public async run<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
    const release = await this.#acquire(signal);
    try {
      if (signal.aborted) throw new AsyncSemaphoreCancelledError();
      return await operation();
    } finally {
      release();
    }
  }

  #acquire(signal: AbortSignal): Promise<() => void> {
    if (signal.aborted) return Promise.reject(new AsyncSemaphoreCancelledError());
    if (this.#active < this.#capacity) {
      this.#active += 1;
      return Promise.resolve(this.#releasePermit());
    }

    return new Promise<() => void>((resolve, reject) => {
      const item: QueuedPermit = {
        signal,
        resolve,
        reject,
        cancel: () => {
          const index = this.#queue.indexOf(item);
          if (index < 0) return;
          this.#queue.splice(index, 1);
          signal.removeEventListener('abort', item.cancel);
          reject(new AsyncSemaphoreCancelledError());
        },
      };
      signal.addEventListener('abort', item.cancel, { once: true });
      this.#queue.push(item);
    });
  }

  #releasePermit(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.#queue.shift();
      if (!next) {
        this.#active -= 1;
        return;
      }
      next.signal.removeEventListener('abort', next.cancel);
      next.resolve(this.#releasePermit());
    };
  }
}
