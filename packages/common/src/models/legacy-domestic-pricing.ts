import {
  normalizeModelPricingId,
  resolveCatalogPricing,
  type TokenPrices,
} from './pricing-catalog.js';

// cc-switch 8be8405 的美元/百万 Token 快照，仅用于国内官网未列价的旧型号。
const minimax: Readonly<Record<string, TokenPrices>> = {
  'minimax-m2': [0.3, 1.2, 0.03, 0.375, 0.375],
  'minimax-m2.1': [0.3, 1.2, 0.03, 0.375, 0.375],
  'minimax-m2.1-lightning': [0.27, 2.33, 0.03, 0, 0],
  'minimax-m2.5': [0.3, 1.2, 0.03, 0.375, 0.375],
  'minimax-m2.5-lightning': [0.3, 2.4, 0.03, 0, 0],
  'minimax-m2.7': [0.3, 1.2, 0.06, 0.375, 0.375],
  'minimax-m2.7-highspeed': [0.6, 2.4, 0.06, 0.375, 0.375],
};
const kimi: Readonly<Record<string, TokenPrices>> = {
  'kimi-k2-0905': [0.55, 2.2, 0.1, 0, 0],
  'kimi-k2-thinking': [0.55, 2.2, 0.1, 0, 0],
  'kimi-k2-turbo': [1.11, 8.06, 0.14, 0, 0],
  'kimi-k2.5': [0.6, 3, 0.1, 0, 0],
};

/** 仅匹配国内按量入口及旧型号白名单；不根据官网查询失败推断需要兜底。 */
export function resolveLegacyDomesticPricing(
  model: string,
  baseUrl: string,
): {
  prices: TokenPrices;
  version: string;
} | null {
  const url = new URL(baseUrl);
  if (/\/coding(?:\/|$)/u.test(url.pathname)) return null;
  // 用完整的查询条件判断是否已有国内目录条目，避免未来新增官网价后仍走旧兜底。
  if (
    resolveCatalogPricing({
      model,
      baseUrl,
      currency: 'CNY',
      inputTokens: 0,
      outputTokens: 0,
      thinking: false,
    })
  )
    return null;
  const id = normalizeModelPricingId(model);
  const prices = ['api.minimaxi.com', 'api.minimax.cn'].includes(url.hostname)
    ? minimax[id]
    : ['api.moonshot.cn', 'api.kimi.com'].includes(url.hostname)
      ? kimi[id]
      : undefined;
  return prices ? { prices, version: `cc-switch-8be8405-usd-reference-${id}` } : null;
}
