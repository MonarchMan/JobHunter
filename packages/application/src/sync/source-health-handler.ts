import { parseId } from '@jobhunter/domain';
import { z } from 'zod';
import type { TaskHandler } from '../tasks/model.js';

/** 应用层数据结构或端口契约。 */
export interface SourceHealthTaskService {
  check(
    sourceId: string,
    signal: AbortSignal,
  ): Promise<{
    readonly status: 'healthy' | 'degraded' | 'unhealthy';
    readonly checkedAt: number;
    readonly latencyMs: number;
    readonly errorCategory?: string | null;
  }>;
}

/** 来源探活任务输入。 */
export const sourceHealthTaskPayloadSchema = z.object({ sourceId: z.uuid() }).strict();
/** 来源探活任务输出。 */
export const sourceHealthTaskOutputSchema = z
  .object({
    status: z.enum(['healthy', 'degraded', 'unhealthy']),
    checkedAt: z.number(),
    latencyMs: z.number().nonnegative(),
    errorCategory: z.string().nullable().optional(),
  })
  .strict();

/** 创建来源探活任务处理器。 */
export function createSourceHealthTaskHandler(
  service: SourceHealthTaskService,
): TaskHandler<
  z.infer<typeof sourceHealthTaskPayloadSchema>,
  z.infer<typeof sourceHealthTaskOutputSchema>
> {
  return {
    taskType: 'source.health-check',
    payloadSchema: sourceHealthTaskPayloadSchema,
    outputSchema: sourceHealthTaskOutputSchema,
    defaultMaxAttempts: 2,
    leaseDurationMs: 60_000,
    concurrencyKey: (payload) => `source-health:${payload.sourceId}`,
    /** 执行应用适配器的该项操作。 */
    async execute(context, payload) {
      const health = await service.check(parseId(payload.sourceId, 'JobSource'), context.signal);
      return {
        status: health.status,
        checkedAt: health.checkedAt,
        latencyMs: health.latencyMs,
        ...(health.errorCategory ? { errorCategory: health.errorCategory } : {}),
      };
    },
  };
}
