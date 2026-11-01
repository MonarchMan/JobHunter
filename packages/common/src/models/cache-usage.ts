import { z } from 'zod';

/** 外部缓存用量可缺失但不能为负数；明确零不得被兼容字段覆盖。 */
export const optionalTokenCount = z.number().int().nonnegative().nullable().optional();
/** Anthropic 与兼容供应商报告的缓存写入时长分布。 */
export const cacheCreationSchema = z
  .object({
    ephemeral_5m_input_tokens: optionalTokenCount,
    ephemeral_1h_input_tokens: optionalTokenCount,
  })
  .nullable()
  .optional();
/** OpenAI 风格的输入细项，不改变总输入已包含缓存的语义。 */
export const inputTokenDetailsSchema = z
  .object({
    cached_tokens: optionalTokenCount,
    cache_write_tokens: optionalTokenCount,
  })
  .nullable()
  .optional();

/** 总写入字段缺失时，仅在两个时长分量均完整时归一化总量。 */
export function cacheWriteTotal(
  total: number | null | undefined,
  durations: z.infer<typeof cacheCreationSchema>,
): number | null {
  if (total != null) return total;
  const short = durations?.ephemeral_5m_input_tokens;
  const long = durations?.ephemeral_1h_input_tokens;
  return short != null && long != null ? short + long : null;
}

/** Kimi Chat 的 TTL 细项来自响应头；缺失保留 null，异常数字在边界拒绝。 */
export function kimiCacheDurations(
  baseUrl: string,
  headers: Headers,
): {
  ephemeral_5m_input_tokens: number | null;
  ephemeral_1h_input_tokens: number | null;
} | null {
  if (!['api.moonshot.cn', 'api.kimi.com'].includes(new URL(baseUrl).hostname)) return null;
  const read = (name: string): number | null => {
    const raw = headers.get(name);
    if (raw === null) return null;
    return z
      .string()
      .regex(/^\d+$/u)
      .transform(Number)
      .pipe(z.number().int().nonnegative())
      .parse(raw);
  };
  return {
    ephemeral_5m_input_tokens: read('Msh-Usage-Cache-Write-Tokens-5m'),
    ephemeral_1h_input_tokens: read('Msh-Usage-Cache-Write-Tokens-1h'),
  };
}
