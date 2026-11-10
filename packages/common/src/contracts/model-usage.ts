import { z } from 'zod';

const count = z.number().int().nonnegative().nullable();
/** 单次请求的用量和价格快照；null 表示未上报或无法定价，不能解释为零。 */
export const modelBillingSchema = z.object({
  requestId: z.string().min(1).optional(),
  /** 已脱敏的传输、协商或输出校验失败原因，不含响应正文。 */
  failureReason: z.string().trim().min(1).max(300).optional(),
  application: z.string().optional(),
  provider: z.string().optional(),
  statusCode: z.number().int().min(100).max(599).nullable().optional(),
  durationMs: count.optional(),
  firstTokenMs: count.optional(),
  outputTokensPerSecond: z.number().nonnegative().nullable().optional(),
  transportError: z
    .enum(['network', 'cancelled', 'timeout', 'invalid_output'])
    .nullable()
    .optional(),
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

/** 请求生命周期快照；开始记录的用量未知，结束后按同一 ID 幂等更新。 */
export const modelRequestRecordSchema = z.object({
  id: z.string().min(1),
  state: z.enum(['running', 'completed']),
  billing: modelBillingSchema,
});
export type ModelRequestRecord = z.infer<typeof modelRequestRecordSchema>;
