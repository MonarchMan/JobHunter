import { z } from 'zod';

const rangeSchema = z.enum(['today', '7d', '30d', 'all']).catch('today');

/** Web 诊断筛选按北京时间自然日转换为含首不含尾的边界，全部不限定时间。 */
export function taskTimeRange(
  value: unknown,
  now = Date.now(),
): {
  readonly range: z.infer<typeof rangeSchema>;
  readonly since?: number;
  readonly before?: number;
} {
  const range = rangeSchema.parse(value);
  if (range === 'all') return { range };
  const day = 86_400_000;
  const offset = 8 * 3_600_000;
  const midnight = Math.floor((now + offset) / day) * day - offset;
  const days = range === '7d' ? 7 : range === '30d' ? 30 : 1;
  return { range, since: midnight - (days - 1) * day, before: midnight + day };
}
