import {
  ModelClientError,
  type ModelClient,
  type ModelRequest,
  type ModelResponse,
} from '@jobhunter/agent-core';

/** 模块使用的类型约束。 */
export type FakeModelStep =
  | ModelResponse
  | ModelClientError
  | ((request: ModelRequest, signal: AbortSignal) => ModelResponse | Promise<ModelResponse>);

/** 用预设步骤模拟模型响应，避免单元测试访问网络。 */
export class FakeModelClient implements ModelClient {
  public readonly metadata;
  public readonly requests: ModelRequest[] = [];
  readonly #steps: FakeModelStep[];

  public constructor(
    steps: readonly FakeModelStep[],
    metadata: ModelClient['metadata'] = {
      provider: 'fake',
      model: 'deterministic-test-model',
      config: { temperature: 0, structuredOutput: true },
      costCurrency: 'USD',
      pricingVersion: 'test-v1',
    },
  ) {
    this.#steps = [...steps];
    this.metadata = metadata;
  }

  /** 消费下一步预设响应并记录请求。 */
  public async complete(request: ModelRequest, signal: AbortSignal): Promise<ModelResponse> {
    if (signal.aborted) throw new ModelClientError('cancelled', 'Fake model request cancelled.');
    this.requests.push(request);
    const step = this.#steps.shift();
    if (!step) throw new ModelClientError('configuration', 'Fake model has no queued response.');
    if (step instanceof ModelClientError) throw step;
    return typeof step === 'function' ? step(request, signal) : step;
  }

  public get remainingSteps(): number {
    return this.#steps.length;
  }
}
