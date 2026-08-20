export interface FakeModelCall<TInput> {
  readonly input: TInput;
}

type QueuedResult<TOutput> =
  | { readonly type: 'success'; readonly value: TOutput }
  | { readonly type: 'failure'; readonly error: Error };

/** Deterministic queue-backed fake that never performs a network request. */
export class FakeModel<TInput, TOutput> {
  readonly calls: FakeModelCall<TInput>[] = [];
  readonly #results: QueuedResult<TOutput>[] = [];

  public enqueue(value: TOutput): void {
    this.#results.push({ type: 'success', value });
  }

  public enqueueFailure(error: Error): void {
    this.#results.push({ type: 'failure', error });
  }

  public invoke(input: TInput): Promise<TOutput> {
    this.calls.push({ input });
    const result = this.#results.shift();
    if (!result) return Promise.reject(new Error('FakeModel has no queued result.'));
    if (result.type === 'failure') return Promise.reject(result.error);
    return Promise.resolve(result.value);
  }
}
