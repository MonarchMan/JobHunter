import type { ModelBilling } from '../contracts/model-usage.js';
import { resolveLegacyDomesticPricing } from './legacy-domestic-pricing.js';
import { resolveGatewayReferencePricing } from './gateway-pricing.js';
import {
  normalizeModelPricingId,
  resolveCatalogPricing,
  type TokenPrices,
} from './pricing-catalog.js';

/** 2026 年官方放假日期；调休工作周末仍按 DeepSeek 的周末规则走闲时。 */
const holidays2026 = [
  ['01-01', '01-03'],
  ['02-15', '02-23'],
  ['04-04', '04-06'],
  ['05-01', '05-05'],
  ['06-19', '06-21'],
  ['09-25', '09-27'],
  ['10-01', '10-07'],
];

/** 根据北京时间判断时段；未知年份的工作日忙时返回 unknown，避免猜测节假日。 */
export function deepSeekPeriod(timestamp: number): ModelBilling['period'] {
  const local = new Date(timestamp + 8 * 60 * 60 * 1000);
  const day = local.getUTCDay();
  const hour = local.getUTCHours();
  if (day === 0 || day === 6 || !((hour >= 9 && hour < 12) || (hour >= 14 && hour < 18)))
    return 'off-peak';
  if (local.getUTCFullYear() !== 2026) return 'unknown';
  const date = local.toISOString().slice(5, 10);
  return holidays2026.some(
    ([start, end]) => start !== undefined && end !== undefined && date >= start && date <= end,
  )
    ? 'off-peak'
    : 'peak';
}

/** 报价包含请求所用档位和版本，计算器据此保存价格快照。 */
export interface ModelPricingQuote {
  readonly prices: TokenPrices;
  readonly period: ModelBilling['period'];
  readonly version: string;
}

/** 供应商、请求时间和用量决定报价档位，显式单价只覆盖对应分项。 */
export interface ModelPricingInput {
  readonly model: string;
  readonly baseUrl: string;
  readonly requestedAt: number;
  readonly currency: 'USD' | 'CNY';
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly thinking?: boolean | null | undefined;
  readonly serviceTier?: string | null | undefined;
  readonly inputPrice?: number | null | undefined;
  readonly outputPrice?: number | null | undefined;
  readonly cacheReadPrice?: number | null | undefined;
  readonly cacheWritePrice?: number | null | undefined;
  readonly cacheWrite1hPrice?: number | null | undefined;
}

/** 1、选取目录报价；2、按请求时间解析官方时段；3、逐项应用配置覆盖。 */
export function resolveModelPricing(input: ModelPricingInput): ModelPricingQuote {
  const catalog =
    resolveCatalogPricing(input) ??
    (input.currency === 'USD' &&
    (!input.serviceTier || ['default', 'standard'].includes(input.serviceTier))
      ? resolveLegacyDomesticPricing(input.model, input.baseUrl)
      : null) ??
    resolveGatewayReferencePricing(input);
  let prices: TokenPrices = catalog?.prices ?? [null, null, null, null, null];
  let period: ModelBilling['period'] = 'fixed';
  let version = catalog?.version ?? 'unpriced';
  const normalized = normalizeModelPricingId(input.model);
  const flash = ['deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp'].includes(
    normalized,
  );
  const pro = normalized === 'deepseek-v4-pro';
  const official = new URL(input.baseUrl).hostname === 'api.deepseek.com' && (flash || pro);
  // 2、官方入口按每次请求时刻选价，显式自定义报价优先；价格生效前不套用新价。
  if (official && (!input.serviceTier || ['default', 'standard'].includes(input.serviceTier))) {
    period =
      input.requestedAt >= Date.parse('2026-09-10T04:00:00Z')
        ? deepSeekPeriod(input.requestedAt)
        : 'unknown';
    const factor = period === 'peak' ? 2 : 1;
    const base: readonly [number, number, number] =
      input.currency === 'CNY'
        ? flash
          ? [1, 4, 0.02]
          : [4.5, 13.5, 0.15]
        : flash
          ? [0.15, 0.6, 0.003]
          : [0.66, 1.98, 0.022];
    prices =
      period === 'unknown'
        ? [null, null, null, null, null]
        : [base[0] * factor, base[1] * factor, base[2] * factor, 0, 0];
    version = `deepseek-2026-09-10-${period}`;
  }
  const overrides = [
    input.inputPrice,
    input.outputPrice,
    input.cacheReadPrice,
    input.cacheWritePrice,
    input.cacheWrite1hPrice,
  ];
  if (overrides.some((price) => price !== undefined)) {
    version = version === 'unpriced' ? 'configured-v2' : `${version}-override`;
  }
  const override = (value: number | null | undefined, fallback: number | null): number | null =>
    value === undefined ? fallback : value;
  return {
    prices: [
      override(input.inputPrice, prices[0]),
      override(input.outputPrice, prices[1]),
      override(input.cacheReadPrice, prices[2]),
      override(input.cacheWritePrice, prices[3]),
      override(input.cacheWrite1hPrice, prices[4]),
    ],
    period,
    version,
  };
}
