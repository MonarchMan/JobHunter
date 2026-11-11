import {
  isDomesticModelApi,
  normalizeModelPricingId,
  type TokenPrices,
} from './pricing-catalog.js';

// CC Switch abf5058 的兼容网关美元参考报价。
const gatewayReferencePrices: Readonly<Record<string, TokenPrices>> = {
  'gpt-4o': [2.5, 10, 1.25, 0, 0],
  'gpt-4o-mini': [0.15, 0.6, 0.075, 0, 0],
  'gpt-4.1': [2, 8, 0.5, 0, 0],
  'gpt-4.1-mini': [0.4, 1.6, 0.1, 0, 0],
  'gpt-4.1-nano': [0.1, 0.4, 0.025, 0, 0],
  o3: [2, 8, 0.5, 0, 0],
  'o3-mini': [1.1, 4.4, 0.55, 0, 0],
  'o4-mini': [1.1, 4.4, 0.275, 0, 0],
  'gpt-5.5': [5, 30, 0.5, 0, 0],
  'gpt-5.4': [2.5, 15, 0.25, 0, 0],
  'gpt-5.4-mini': [0.75, 4.5, 0.075, 0, 0],
  // CC Switch 保存五分钟写价，Claude 一小时写价按标准输入的 2 倍。
  'claude-opus-4-5': [5, 25, 0.5, 6.25, 10],
  'claude-opus-4': [15, 75, 1.5, 18.75, 30],
  'claude-sonnet-4': [3, 15, 0.3, 3.75, 6],
  'claude-3-5-sonnet': [3, 15, 0.3, 3.75, 6],
  'claude-3-5-haiku': [0.8, 4, 0.08, 1, 1.6],
  'claude-sonnet-4-5': [3, 15, 0.3, 3.75, 6],
  'claude-haiku-4-5': [1, 5, 0.1, 1.25, 2],
  'deepseek-flash': [0.3, 1.2, 0.006, 0, 0],
  'deepseek-v4-pro': [1.32, 3.96, 0.044, 0, 0],
  'deepseek-v4-flash': [0.3, 1.2, 0.006, 0, 0],
  'deepseek-v4-flash-vision-exp': [0.3, 1.2, 0.006, 0, 0],
  'deepseek-chat': [0.44, 1.32, 0.014, 0, 0],
  'deepseek-reasoner': [0.44, 1.32, 0.014, 0, 0],
  'deepseek-v3': [0.28, 1.11, 0.028, 0, 0],
  'kimi-k2': [0.55, 2.2, 0.1, 0, 0],
  'kimi-k2-0905': [0.55, 2.2, 0.1, 0, 0],
  'kimi-k2-thinking': [0.55, 2.2, 0.1, 0, 0],
  'kimi-k2-turbo': [1.11, 8.06, 0.14, 0, 0],
  'kimi-k2.5': [0.6, 3, 0.1, 0, 0],
  'kimi-k2.6': [0.95, 4, 0.16, 0, 0],
  'kimi-k2.7-code': [0.95, 4, 0.19, 0, 0],
  'kimi-k3': [3, 15, 0.3, 3, 3],
  'kimi-k3.1-pro': [2, 10, 0.2, 2, 2],
  'kimi-k3.1-pro-highspeed': [4, 20, 0.2, 4, 4],
  'minimax-m2': [0.3, 1.2, 0.03, 0.375, 0.375],
  'minimax-m2.1': [0.3, 1.2, 0.03, 0.375, 0.375],
  'minimax-m2.1-lightning': [0.27, 2.33, 0.03, 0, 0],
  'minimax-m2.5': [0.3, 1.2, 0.03, 0.375, 0.375],
  'minimax-m2.5-lightning': [0.3, 2.4, 0.03, 0, 0],
  'minimax-m2.7': [0.3, 1.2, 0.06, 0.375, 0.375],
  'minimax-m2.7-highspeed': [0.6, 2.4, 0.06, 0.375, 0.375],
  'minimax-m3': [0.3, 1.2, 0.06, 0, 0],
  'minimax-m3.1-flash': [0.15, 0.6, 0.015, 0, 0],
  'glm-4.7': [0.6, 2.2, 0.11, 0, 0],
  'glm-5': [1, 3.2, 0.2, 0, 0],
  'glm-5.1': [1.4, 4.4, 0.26, 0, 0],
  'glm-5.2': [1.4, 4.4, 0.26, 0, 0],
  'glm-5.3': [1.4, 4.4, 0.26, 0, 0],
  'glm-5.3-flash': [0.15, 0.5, 0.03, 0, 0],
  'glm-5.3-flashx': [0.37, 1.25, 0.075, 0, 0],
};

// 历史供应商报价。Qwen 使用既有美元参考基准和百炼隐式缓存折扣，显式缓存未知。
const supplementalReferencePrices: Readonly<Record<string, TokenPrices>> = {
  'glm-4-plus': [5 / 7, 5 / 7, null, null, null],
  'glm-4-flash': [0.1 / 7, 0.1 / 7, null, null, null],
  'moonshot-v1-8k': [12 / 7, 12 / 7, null, null, null],
  'moonshot-v1-32k': [24 / 7, 24 / 7, null, null, null],
  'moonshot-v1-128k': [60 / 7, 60 / 7, null, null, null],
  'claude-3-7-sonnet': [3, 15, 0.3, 3.75, 6],
  'deepseek-r1': [0.55, 2.19, 0.14, 0, 0],
  'qwen-plus': [0.8 / 7, 2 / 7, 0.16 / 7, null, null],
  'qwen-turbo': [0.3 / 7, 0.6 / 7, 0.06 / 7, null, null],
  'qwen-max': [2.4 / 7, 9.6 / 7, 0.48 / 7, null, null],
};

/** 为兼容网关的标准美元计费提供参考报价，未公开的缓存分项保持未知。 */
export function resolveGatewayReferencePricing(input: {
  model: string;
  baseUrl: string;
  currency: 'USD' | 'CNY';
  serviceTier?: string | null | undefined;
}): { prices: TokenPrices; version: string } | null {
  if (input.currency !== 'USD' || isDomesticModelApi(input.baseUrl)) return null;
  if (input.serviceTier && !['default', 'standard'].includes(input.serviceTier)) return null;
  if (/\/coding(?:\/|$)/u.test(new URL(input.baseUrl).pathname)) return null;
  const model = normalizeModelPricingId(input.model);
  const ccSwitch = Object.hasOwn(gatewayReferencePrices, model)
    ? gatewayReferencePrices[model]
    : undefined;
  if (ccSwitch) return { prices: ccSwitch, version: 'gateway-reference-cc-switch-abf5058' };
  const supplemental = Object.hasOwn(supplementalReferencePrices, model)
    ? supplementalReferencePrices[model]
    : undefined;
  if (supplemental) return { prices: supplemental, version: 'gateway-reference-provider-2026-11' };
  return null;
}
