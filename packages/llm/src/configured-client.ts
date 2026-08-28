import type { ModelClient } from '@jobhunter/agent-core';
import { registerAnthropicProvider } from './anthropic-client.js';
import { registerOpenAiCompatibleProvider } from './openai-compatible-client.js';
import { ModelProviderRegistry } from './provider-registry.js';

export interface ConfiguredModelClientInput {
  readonly provider: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly timeoutMs?: number;
}

export function createConfiguredModelClient(input: ConfiguredModelClientInput): ModelClient {
  const registry = new ModelProviderRegistry();
  registerOpenAiCompatibleProvider(registry);
  registerAnthropicProvider(registry);
  return registry.create(input.provider, {
    baseUrl: input.baseUrl,
    apiKey: input.apiKey,
    model: input.model,
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
  });
}
