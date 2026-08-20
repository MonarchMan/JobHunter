import type { ModelClient } from '@jobhunter/agent-core';

export type ModelClientFactory = (config: Readonly<Record<string, unknown>>) => ModelClient;

export class ModelProviderRegistry {
  readonly #factories = new Map<string, ModelClientFactory>();

  public register(provider: string, factory: ModelClientFactory): void {
    const key = provider.trim();
    if (!key) throw new TypeError('Model provider key is required.');
    if (this.#factories.has(key)) throw new TypeError(`Duplicate model provider: ${key}.`);
    this.#factories.set(key, factory);
  }

  public create(provider: string, config: Readonly<Record<string, unknown>>): ModelClient {
    const factory = this.#factories.get(provider);
    if (!factory) throw new TypeError(`Unknown model provider: ${provider}.`);
    return factory(config);
  }

  public has(provider: string): boolean {
    return this.#factories.has(provider);
  }
}
