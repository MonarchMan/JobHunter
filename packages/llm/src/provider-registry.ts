import type { ModelClient } from '@jobhunter/agent-core';

/** 模块使用的类型约束。 */
export type ModelClientFactory = (config: Readonly<Record<string, unknown>>) => ModelClient;

/** 注册并解析 OpenAI 兼容、Anthropic 等模型提供方。 */
export class ModelProviderRegistry {
  readonly #factories = new Map<string, ModelClientFactory>();

  /** 注册一个唯一的提供方工厂。 */
  public register(provider: string, factory: ModelClientFactory): void {
    const key = provider.trim();
    if (!key) throw new TypeError('Model provider key is required.');
    if (this.#factories.has(key)) throw new TypeError(`Duplicate model provider: ${key}.`);
    this.#factories.set(key, factory);
  }

  /** 使用已注册提供方创建模型客户端。 */
  public create(provider: string, config: Readonly<Record<string, unknown>>): ModelClient {
    const factory = this.#factories.get(provider);
    if (!factory) throw new TypeError(`Unknown model provider: ${provider}.`);
    return factory(config);
  }

  /** 执行模块组件对外暴露的操作。 */
  public has(provider: string): boolean {
    return this.#factories.has(provider);
  }
}
