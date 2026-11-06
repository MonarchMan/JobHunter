import { z } from 'zod';
import { classifyTaskError, TaskExecutionError, type TaskHandler } from '@jobhunter/common/tasks';
import {
  manualJobScoreTaskPayloadSchema,
  type createManualJobScoreTaskHandler,
} from './manual-job-score-handler.js';

const itemSchema = z
  .object({
    jobRevisionId: z.uuidv7(),
    status: z.enum(['succeeded', 'failed']),
    result: z.unknown(),
    error: z.string().nullable(),
  })
  .strict();
const progressSchema = z.object({ items: z.array(itemSchema).max(100) }).strict();
const payloadSchema = z
  .object({
    jobRevisionIds: z
      .array(z.uuidv7())
      .min(1)
      .max(100)
      .refine((ids) => new Set(ids).size === ids.length),
    profileVersionId: z.uuidv7(),
    mode: z.enum(['rules', 'llm']),
    progress: progressSchema.optional(),
  })
  .strict();

/** 一个任务串行执行整批职位；逐项持久化，已成功项在所有重试中跳过。 */
export function createBatchJobScoreTaskHandler(
  single: ReturnType<typeof createManualJobScoreTaskHandler>,
): TaskHandler<z.infer<typeof payloadSchema>, z.infer<typeof progressSchema>> {
  return {
    taskType: 'match.score-batch',
    payloadSchema,
    outputSchema: progressSchema,
    defaultMaxAttempts: 3,
    leaseDurationMs: single.leaseDurationMs,
    retryPayload: (value, result) => {
      const payload = payloadSchema.parse(value);
      const progress = progressSchema.safeParse(result);
      return progress.success ? { ...payload, progress: progress.data } : payload;
    },
    async execute(context, payload) {
      const items = new Map(
        (payload.progress?.items ?? [])
          .filter((item) => payload.jobRevisionIds.includes(item.jobRevisionId))
          .map((item) => [item.jobRevisionId, item]),
      );
      // 1、使用冻结修订逐项执行，不再创建子任务；检查点只包含结果 ID 和脱敏错误。
      for (const jobRevisionId of payload.jobRevisionIds) {
        if (context.signal.aborted)
          throw new TaskExecutionError('cancelled', '批量评分已取消。', {
            result: { items: [...items.values()] },
          });
        const previous = items.get(jobRevisionId);
        if (previous?.status === 'succeeded') continue;
        const base = {
          jobRevisionId,
          profileVersionId: payload.profileVersionId,
          mode: payload.mode,
          requireModelScore: true,
        };
        const input = manualJobScoreTaskPayloadSchema.parse(
          single.retryPayload?.(base, previous?.result) ?? base,
        );
        let item: z.infer<typeof itemSchema>;
        try {
          // 子处理器不能覆盖批次检查点；本轮 attempt 仍由批次统一控制。
          const { checkpoint: _checkpoint, ...childContext } = context;
          void _checkpoint;
          const result = await single.execute(childContext, input);
          item = { jobRevisionId, status: 'succeeded', result, error: null };
        } catch (error) {
          const classified = classifyTaskError(error);
          item = {
            jobRevisionId,
            status: 'failed',
            result: classified.result ?? null,
            error: classified.safeSummary,
          };
        }
        items.set(jobRevisionId, item);
        context.checkpoint?.({ items: [...items.values()] });
      }
      // 2、失败不能伪装为整体成功；重试输入保留成功项，失败项重新运行统一职位分析。
      const result = { items: [...items.values()] };
      const failed = result.items.filter((item) => item.status === 'failed');
      if (failed.length)
        throw new TaskExecutionError(
          'network_temporary',
          `${String(failed.length)} 个职位评分失败，共 ${String(payload.jobRevisionIds.length)} 个；重试仅处理失败项。`,
          { retryable: true, result },
        );
      return result;
    },
  };
}
