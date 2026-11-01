/** 报价快照使用原生币种；顺序为输入、输出、缓存读、短时写、1 小时写。 */
export type TokenPrices = readonly [
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
];

/** 统一路由前缀与常见日期后缀；查价仍要求匹配供应商入口。 */
export function normalizeModelPricingId(model: string): string {
  const basename = model.trim().toLowerCase().split('/').at(-1) ?? '';
  return (basename.split(':')[0] ?? '')
    .replaceAll('@', '-')
    .replace(/-(?:\d{8}|\d{4}-\d{2}-\d{2})$/u, '');
}

// 2026-11-01 核验的国内原生人民币报价，来源见 specs/008。
const kimi: Readonly<Record<string, TokenPrices>> = {
  'kimi-k3': [20, 100, 2, 20, 40],
  'kimi-k3.1-pro': [13, 68, 1.3, 13, null],
  'kimi-k3.1-pro-highspeed': [26, 136, 1.3, 26, null],
  'kimi-k2.6': [6.5, 27, 1.1, 0, 0],
  'kimi-k2.7-code': [6.5, 27, 1.3, 0, 0],
};
const bigmodel: Readonly<Record<string, TokenPrices>> = {
  'glm-5.3': [8, 28, 2, 0, 0],
  'glm-5.3-flash': [0.8, 2.8, 0.23, 0, 0],
  'glm-5.3-flashx': [2, 7, 0.57, 0, 0],
  'glm-5.2': [8, 28, 2, 0, 0],
  'glm-4-plus': [5, 5, 2.5, 0, 0],
  'glm-4.7-flashx': [0.5, 3, 0.1, 0, 0],
  'glm-4.7-flash': [0, 0, 0, 0, 0],
  'glm-4-flash-250414': [0, 0, null, 0, 0],
};
const minimax: Readonly<Record<string, TokenPrices>> = {
  'minimax-m3': [2.1, 8.4, 0.42, 0, 0],
  'minimax-m3.1-flash': [1, 4, 0.1, 0, 0],
};

/** 国内按量入口；海外版本和第三方代理不在本次自动报价范围内。 */
export function isDomesticModelApi(baseUrl: string): boolean {
  return [
    'api.deepseek.com',
    'open.bigmodel.cn',
    'dashscope.aliyuncs.com',
    'api.moonshot.cn',
    'api.kimi.com',
    'api.minimaxi.com',
    'api.minimax.cn',
  ].includes(new URL(baseUrl).hostname);
}

/** 仅查询当前同步文本请求可确定的官方价格；未知必要条件返回空，不假定最低阶梯。 */
export function resolveCatalogPricing(input: {
  model: string;
  baseUrl: string;
  currency: 'USD' | 'CNY';
  inputTokens: number | null;
  outputTokens?: number | null | undefined;
  thinking?: boolean | null | undefined;
  serviceTier?: string | null | undefined;
}): { prices: TokenPrices; version: string } | null {
  const url = new URL(input.baseUrl);
  const host = url.hostname;
  const model = normalizeModelPricingId(input.model);
  const tier = input.serviceTier;
  // 套餐入口和第三方网关不等于按量官网，不能凭相同模型名称套用价格。
  if (/\/coding(?:\/|$)/u.test(url.pathname)) return null;
  if (tier && !['default', 'standard'].includes(tier)) return null;
  let prices: TokenPrices | undefined;
  let suffix = 'standard';
  if (input.currency !== 'CNY') return null;
  if (host === 'open.bigmodel.cn') {
    prices = bigmodel[model];
    if (['glm-5.1', 'glm-5', 'glm-4.7'].includes(model)) {
      if (input.inputTokens === null) return null;
      const long = input.inputTokens >= 32_000;
      suffix = long ? 'long-context' : 'short-context';
      if (model === 'glm-5.1') prices = long ? [8, 28, 2, 0, 0] : [6, 24, 1.3, 0, 0];
      else if (model === 'glm-5') prices = long ? [6, 22, 1.5, 0, 0] : [4, 18, 1, 0, 0];
      else {
        if (!long && input.outputTokens == null) return null;
        prices = long
          ? [4, 16, 0.8, 0, 0]
          : (input.outputTokens ?? 0) < 200
            ? [2, 8, 0.4, 0, 0]
            : [3, 14, 0.6, 0, 0];
        suffix += !long && (input.outputTokens ?? 0) >= 200 ? '-long-output' : '';
      }
    }
  } else if (['api.moonshot.cn', 'api.kimi.com'].includes(host)) {
    prices = kimi[model];
  } else if (['api.minimaxi.com', 'api.minimax.cn'].includes(host)) {
    prices = minimax[model];
    if (model === 'minimax-m3') {
      if (input.inputTokens === null) return null;
      if (input.inputTokens > 512_000) {
        prices = [4.2, 16.8, 0.84, 0, 0];
        suffix = 'long-context';
      }
    }
  } else if (host === 'dashscope.aliyuncs.com') {
    // 这里只覆盖北京地域的隐式缓存；应用没有发送显式缓存标记。
    if (model === 'qwen-max') prices = [2.4, 9.6, 0.48, null, null];
    if (model === 'qwen-turbo')
      prices = [0.3, input.thinking == null ? null : input.thinking ? 3 : 0.6, null, null, null];
    if (model === 'qwen-plus') {
      if (input.inputTokens === null) return null;
      const row: readonly [number, number, number] =
        input.inputTokens <= 128_000
          ? [0.8, 2, 8]
          : input.inputTokens <= 256_000
            ? [2.4, 20, 24]
            : [4.8, 48, 64];
      prices = [
        row[0],
        input.thinking == null ? null : row[input.thinking ? 2 : 1],
        row[0] * 0.2,
        null,
        null,
      ];
      suffix = `implicit-${input.inputTokens <= 128_000 ? '128k' : input.inputTokens <= 256_000 ? '256k' : '1m'}-${input.thinking == null ? 'unknown-mode' : input.thinking ? 'thinking' : 'non-thinking'}`;
    }
  }
  return prices
    ? { prices, version: `catalog-2026-11-01-${model}-${input.currency}-${suffix}` }
    : null;
}
