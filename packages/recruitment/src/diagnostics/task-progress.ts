import { z } from 'zod';
import { webBatchProgressSchema } from '../contracts/web.js';

const payloadSchema = z.object({
  jobRevisionIds: z
    .array(z.string().min(1))
    .min(1)
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length),
  progress: z.unknown().optional(),
});
const checkpointSchema = z.object({
  items: z
    .array(
      z.object({
        jobRevisionId: z.string().min(1),
        status: z.enum(['succeeded', 'failed']),
      }),
    )
    .max(100),
});

/** 从批量评分的冻结输入及检查点投影已处理数量；排除越界和重复项。 */
export function presentBatchProgress(
  taskType: string,
  payload: unknown,
  result: unknown,
): z.infer<typeof webBatchProgressSchema> | null {
  if (taskType !== 'match.score-batch') return null;
  const input = payloadSchema.safeParse(payload);
  if (!input.success) return null;
  // 重试尚未产生新检查点时沿用输入中的进度，已成功项不应退回零。
  const checkpoint = checkpointSchema.safeParse(result ?? input.data.progress);
  const processed = new Set(
    checkpoint.success
      ? checkpoint.data.items
          .filter((item) => input.data.jobRevisionIds.includes(item.jobRevisionId))
          .map((item) => item.jobRevisionId)
      : [],
  ).size;
  return webBatchProgressSchema.parse({ total: input.data.jobRevisionIds.length, processed });
}
