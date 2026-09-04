import type { ModelClient } from '@jobhunter/agent-core';
import { registerAnthropicProvider } from './anthropic-client.js';
import { registerOpenAiCompatibleProvider } from './openai-compatible-client.js';
import { ModelProviderRegistry } from './provider-registry.js';

/** 模块数据结构或契约。 */
export interface ConfiguredModelClientInput {
  readonly provider: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly timeoutMs?: number;
}

/** 按 provider registry 解析配置并创建模型客户端。 */
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
