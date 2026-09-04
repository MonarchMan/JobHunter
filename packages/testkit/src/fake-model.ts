/** 模块数据结构或契约。 */
export interface FakeModelCall<TInput> {
  readonly input: TInput;
}

type QueuedResult<TOutput> =
  | { readonly type: 'success'; readonly value: TOutput }
  | { readonly type: 'failure'; readonly error: Error };

/** Deterministic queue-backed fake that never performs a network request. */
/** 以队列结果模拟模型成功、失败和调用记录。 */
export class FakeModel<TInput, TOutput> {
  readonly calls: FakeModelCall<TInput>[] = [];
  readonly #results: QueuedResult<TOutput>[] = [];

  /** 排入一次成功响应。 */
  public enqueue(value: TOutput): void {
    this.#results.push({ type: 'success', value });
  }

  /** 排入一次失败响应。 */
  public enqueueFailure(error: Error): void {
    this.#results.push({ type: 'failure', error });
  }

  /** 消费队列头部响应并记录调用。 */
  public invoke(input: TInput): Promise<TOutput> {
    this.calls.push({ input });
    const result = this.#results.shift();
    if (!result) return Promise.reject(new Error('FakeModel has no queued result.'));
    if (result.type === 'failure') return Promise.reject(result.error);
    return Promise.resolve(result.value);
  }
}
