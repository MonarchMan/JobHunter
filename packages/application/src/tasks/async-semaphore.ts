/** 应用层数据结构或端口契约。 */
interface QueuedPermit {
  readonly signal: AbortSignal;
  readonly resolve: (release: () => void) => void;
  readonly reject: (error: AsyncSemaphoreCancelledError) => void;
  readonly cancel: () => void;
}

/** 信号量等待被取消时抛出的错误。 */
export class AsyncSemaphoreCancelledError extends Error {
  public constructor() {
    super('Semaphore wait was cancelled.');
    this.name = 'AsyncSemaphoreCancelledError';
  }
}

/** FIFO、支持取消的异步信号量，不阻塞执行线程。 */
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

  /** 获取许可后执行操作，并在成功、失败或取消时释放许可。 */
  public async run<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
    // 1、等待许可；2. 执行操作；3. 无论结果如何释放许可。
    const release = await this.#acquire(signal);
    try {
      if (signal.aborted) throw new AsyncSemaphoreCancelledError();
      return await operation();
    } finally {
      release();
    }
  }

  /** 处理应用类内部的辅助逻辑。 */
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

  /** 处理应用类内部的辅助逻辑。 */
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
