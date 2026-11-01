import { z } from 'zod';

const count = z.number().int().nonnegative().nullable();
/** 单次请求的用量和价格快照；null 表示未上报或无法定价，不能解释为零。 */
export const modelBillingSchema = z.object({
  model: z.string(),
  requestedAt: z.number().int().nonnegative(),
  inputTokens: count,
  outputTokens: count,
  cacheReadTokens: count,
  cacheWriteTokens: count,
  cacheWrite5mTokens: count.optional(),
  cacheWrite1hTokens: count.optional(),
  cacheWrite5mCostMicros: count.optional(),
  cacheWrite1hCostMicros: count.optional(),
  uncachedInputTokens: count,
  inputCostMicros: count,
  outputCostMicros: count,
  cacheReadCostMicros: count,
  cacheWriteCostMicros: count,
  totalCostMicros: count,
  currency: z.enum(['USD', 'CNY']),
  pricingVersion: z.string(),
  period: z.enum(['peak', 'off-peak', 'fixed', 'unknown']),
  precision: z.enum(['reported', 'cache-miss-assumed', 'unpriced']),
  rates: z
    .object({
      input: count,
      output: count,
      cacheRead: count,
      cacheWrite: count,
      cacheWrite1h: count.optional(),
    })
    .nullable(),
});
/** 微单位报价与用量快照，供持久化及只读页面共享。 */
export type ModelBilling = z.infer<typeof modelBillingSchema>;
