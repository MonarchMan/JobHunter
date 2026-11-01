import { normalizeModelPricingId } from './pricing-catalog.js';

/** 原有基础美元估算目录：海外版不在本次改动范围，保持已有输入/输出规则。 */
const defaultModelPricing: Readonly<Record<string, readonly [number, number]>> = {
  // OpenAI
  'gpt-4o': [2.5, 10],
  'gpt-4o-mini': [0.15, 0.6],
  'gpt-4.1': [2, 8],
  'gpt-4.1-mini': [0.4, 1.6],
  'gpt-4.1-nano': [0.1, 0.4],
  o3: [2, 8],
  'o3-mini': [1.1, 4.4],
  'o4-mini': [1.1, 4.4],
  'claude-opus-4-5': [5, 25],
  'claude-opus-4': [15, 75],
  'claude-sonnet-4': [3, 15],
  'claude-3-7-sonnet': [3, 15],
  'claude-3-5-sonnet': [3, 15],
  'claude-3-5-haiku': [0.8, 4],
  'claude-sonnet-4-5': [3, 15],
  'claude-haiku-4-5': [1, 5],
  'gpt-5.5': [5, 30],
  'gpt-5.4': [2.5, 15],
  'gpt-5.4-mini': [0.2, 1.25],
  'deepseek-v4-flash': [1 / 7, 2 / 7],
  'deepseek-v4-pro': [12 / 7, 24 / 7],
  'deepseek-chat': [0.7 / 7, 2.8 / 7],
  'deepseek-reasoner': [4 / 7, 16 / 7],
  'deepseek-v3': [0.7 / 7, 2.8 / 7],
  'deepseek-r1': [4 / 7, 16 / 7],
  'kimi-k2': [4 / 7, 16 / 7],
  'moonshot-v1-8k': [12 / 7, 12 / 7],
  'moonshot-v1-32k': [24 / 7, 24 / 7],
  'moonshot-v1-128k': [60 / 7, 60 / 7],
  'minimax-m2.1': [2.1 / 7, 8.4 / 7],
  'glm-4.7': [2 / 7, 8 / 7],
  'glm-4-plus': [5 / 7, 5 / 7],
  'glm-4-flash': [0.1 / 7, 0.1 / 7],
  'qwen-plus': [0.8 / 7, 2 / 7],
  'qwen-turbo': [0.3 / 7, 0.6 / 7],
  'qwen-max': [2.4 / 7, 9.6 / 7],
  // Z.ai 海外 API 公开价，单位 USD / 百万 Token；BigModel 国内人民币价需显式覆盖。
  'glm-5.3': [1.4, 4.4],
  'glm-5.3-flash': [0.15, 0.5],
  'glm-5.3-flashx': [0.37, 1.25],
};

/** 保留既有模型名称归一化和两项基础价格；不为海外版本增加缓存报价。 */
export function resolveLegacyPricing(model: string | null): readonly [number, number] | null {
  return model ? (defaultModelPricing[normalizeModelPricingId(model)] ?? null) : null;
}
