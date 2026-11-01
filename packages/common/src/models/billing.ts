import { modelBillingSchema, type ModelBilling } from '../contracts/model-usage.js';
import { z } from 'zod';
import { resolveLegacyDomesticPricing } from './legacy-domestic-pricing.js';
import {
  isDomesticModelApi,
  normalizeModelPricingId,
  resolveCatalogPricing,
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

/** 输入以总输入量为准，缓存部分互斥；价格单位为每百万 Token 的币种金额。 */
export interface BillingInput {
  model: string;
  baseUrl: string;
  requestedAt: number;
  currency: 'USD' | 'CNY';
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  uncachedInputTokens: number | null;
  inputPrice?: number | null | undefined;
  outputPrice?: number | null | undefined;
  cacheReadPrice?: number | null | undefined;
  cacheWritePrice?: number | null | undefined;
  cacheWrite1hPrice?: number | null | undefined;
  cacheWrite5mTokens?: number | null | undefined;
  cacheWrite1hTokens?: number | null | undefined;
  thinking?: boolean | null | undefined;
  serviceTier?: string | null | undefined;
  autoModelPricing?: boolean | undefined;
}

/** 分项计算微单位成本；先定点化报价，用整数完成乘法与舍入。 */
export function calculateBilling(input: BillingInput): ModelBilling {
  // 1、校验计费输入及互斥的缓存分量，冲突数据不进入计价。
  for (const value of [
    input.inputTokens,
    input.outputTokens,
    input.cacheReadTokens,
    input.cacheWriteTokens,
    input.uncachedInputTokens,
    input.cacheWrite5mTokens ?? null,
    input.cacheWrite1hTokens ?? null,
  ]) {
    if (value !== null && (!Number.isSafeInteger(value) || value < 0))
      throw new z.ZodError([{ code: 'custom', path: ['usage'], message: 'Invalid token usage.' }]);
  }
  const total = input.inputTokens;
  if (
    total !== null &&
    (input.cacheReadTokens ?? 0) +
      (input.cacheWriteTokens ?? 0) +
      (input.uncachedInputTokens ?? 0) >
      total
  )
    throw new z.ZodError([
      { code: 'custom', path: ['usage'], message: 'Conflicting cache usage.' },
    ]);
  const shortWrites = input.cacheWrite5mTokens ?? null;
  const longWrites = input.cacheWrite1hTokens ?? null;
  if (
    input.cacheWriteTokens !== null &&
    ((shortWrites ?? 0) + (longWrites ?? 0) > input.cacheWriteTokens ||
      (shortWrites !== null &&
        longWrites !== null &&
        shortWrites + longWrites !== input.cacheWriteTokens))
  )
    throw new z.ZodError([
      { code: 'custom', path: ['usage'], message: 'Conflicting cache duration usage.' },
    ]);
  let prices = [
    input.inputPrice,
    input.outputPrice,
    input.cacheReadPrice,
    input.cacheWritePrice,
    input.cacheWrite1hPrice === undefined ? input.cacheWritePrice : input.cacheWrite1hPrice,
  ];
  let period: ModelBilling['period'] = 'fixed';
  let version = 'configured-v2';
  const automatic =
    input.autoModelPricing ?? (input.inputPrice == null && input.outputPrice == null);
  if (automatic) {
    const catalog =
      resolveCatalogPricing(input) ??
      (input.currency === 'USD' &&
      (!input.serviceTier || ['default', 'standard'].includes(input.serviceTier))
        ? resolveLegacyDomesticPricing(input.model, input.baseUrl)
        : null);
    if (catalog) {
      prices = [...catalog.prices];
      version = catalog.version;
    } else if (isDomesticModelApi(input.baseUrl)) {
      prices = [null, null, null, null, null];
      version = 'unpriced';
    }
  }
  const normalized = normalizeModelPricingId(input.model);
  const flash = ['deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp'].includes(
    normalized,
  );
  const pro = normalized === 'deepseek-v4-pro';
  const official = new URL(input.baseUrl).hostname === 'api.deepseek.com' && (flash || pro);
  // 2、官方入口按每次请求时刻选价，显式自定义报价优先；价格生效前不套用新价。
  if (
    official &&
    automatic &&
    (!input.serviceTier || ['default', 'standard'].includes(input.serviceTier))
  ) {
    period =
      input.requestedAt >= Date.parse('2026-09-10T04:00:00Z')
        ? deepSeekPeriod(input.requestedAt)
        : 'unknown';
    const factor = period === 'peak' ? 2 : 1;
    const base =
      input.currency === 'CNY'
        ? flash
          ? [1, 4, 0.02, 0, 0]
          : [4.5, 13.5, 0.15, 0, 0]
        : flash
          ? [0.15, 0.6, 0.003, 0, 0]
          : [0.66, 1.98, 0.022, 0, 0];
    prices =
      period === 'unknown' ? [null, null, null, null, null] : base.map((price) => price * factor);
    version = `deepseek-2026-09-10-${period}`;
  }
  // 明确设置的缓存报价（含零和 null）逐项覆盖，缺省才使用目录。
  for (const [index, override] of [
    [2, input.cacheReadPrice],
    [3, input.cacheWritePrice],
    [4, input.cacheWrite1hPrice],
  ] as const) {
    if (override !== undefined) {
      prices[index] = override;
      if (automatic) version += '-cache-override';
    }
  }
  const rates = prices.map((price) => {
    if (price == null) return null;
    if (!Number.isFinite(price) || price < 0) throw new TypeError('Invalid token price.');
    return Math.round(price * 1_000_000);
  });
  /** 将单项 Token 与微单位报价相乘；零用量无需报价即可确定零成本。 */
  const cost = (tokens: number | null, rate: number | null | undefined): number | null => {
    if (tokens === 0) return 0;
    if (tokens === null || rate == null) return null;
    return Number((BigInt(tokens) * BigInt(rate) + 500_000n) / 1_000_000n);
  };
  // 3、未知缓存按未命中提供估算；缓存写入可能更贵，因此不声称这是上界。
  const assumed =
    input.uncachedInputTokens === null ||
    input.cacheReadTokens === null ||
    (input.cacheWriteTokens === null && (rates[3] !== 0 || rates[4] !== 0));
  const uncached =
    total === null
      ? input.uncachedInputTokens
      : total - (input.cacheReadTokens ?? 0) - (input.cacheWriteTokens ?? 0);
  const shortCount =
    shortWrites ??
    (input.cacheWriteTokens !== null && longWrites !== null
      ? input.cacheWriteTokens - longWrites
      : null);
  const longCount =
    longWrites ??
    (input.cacheWriteTokens !== null && shortWrites !== null
      ? input.cacheWriteTokens - shortWrites
      : null);
  const shortCost = cost(shortCount, rates[3]);
  const longCost = cost(longCount, rates[4]);
  // 不同 TTL 价格必须有时长分布，不能把未知的一小时写入按五分钟结算。
  const writeCost =
    input.cacheWriteTokens === 0 || input.cacheWriteTokens === null
      ? 0
      : shortCost !== null && longCost !== null
        ? shortCost + longCost
        : rates[3] === rates[4]
          ? cost(input.cacheWriteTokens, rates[3])
          : null;
  const parts = [
    cost(uncached, rates[0]),
    cost(input.outputTokens, rates[1]),
    cost(input.cacheReadTokens ?? 0, rates[2]),
    writeCost,
  ];
  const sum = parts.some((part) => part === null)
    ? null
    : parts.reduce<number>((value, part) => value + (part ?? 0), 0);
  return modelBillingSchema.parse({
    ...input,
    cacheWrite5mTokens: shortWrites,
    cacheWrite1hTokens: longWrites,
    cacheWrite5mCostMicros: shortCost,
    cacheWrite1hCostMicros: longCost,
    inputCostMicros: parts[0],
    outputCostMicros: parts[1],
    cacheReadCostMicros: parts[2],
    cacheWriteCostMicros: parts[3],
    totalCostMicros: sum,
    pricingVersion: version,
    period,
    precision: sum === null ? 'unpriced' : assumed ? 'cache-miss-assumed' : 'reported',
    rates: {
      input: rates[0],
      output: rates[1],
      cacheRead: rates[2],
      cacheWrite: rates[3],
      cacheWrite1h: rates[4] ?? null,
    },
  });
}
