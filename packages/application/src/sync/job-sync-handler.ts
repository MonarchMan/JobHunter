import { parseId } from '@jobhunter/domain';
import { z } from 'zod';
import type { TaskErrorCategory, TaskHandler } from '../tasks/model.js';
import { TaskExecutionError } from '../tasks/retry-policy.js';
import type { JobSyncService } from './job-sync-service.js';

/** 来源同步任务输入。 */
export const sourceSyncTaskPayloadSchema = z
  .object({
    sourceId: z.string().trim().min(1),
    trigger: z.enum(['manual', 'schedule', 'retry']),
  })
  .strict();

/** 来源同步任务输出统计。 */
export const sourceSyncTaskOutputSchema = z
  .object({
    runId: z.string().trim().min(1),
    status: z.enum(['succeeded', 'partial', 'failed', 'cancelled', 'conflict']),
    coverage: z.enum(['complete', 'partial', 'unknown']).nullable(),
  })
  .strict();

/** 执行应用层的解析、转换或编排辅助逻辑。 */
function taskErrorCategory(sourceCategory: string | null): TaskErrorCategory {
  switch (sourceCategory) {
    case 'temporary':
      return 'network_temporary';
    case 'rate_limited':
      return 'rate_limited';
    case 'invalid_config':
      return 'invalid_config';
    case 'parse_changed':
      return 'parse_changed';
    case 'cancelled':
      return 'cancelled';
    case 'access_blocked':
    case 'not_found':
    case 'isolated_items':
    case 'internal':
    default:
      return 'permanent';
  }
}

/** 创建来源同步任务处理器。 */
export function createSourceSyncTaskHandler(
  // 1、校验来源快照；2、执行同步服务；3、将失败分类为可重试或终态。
  service: Pick<JobSyncService, 'run'>,
): TaskHandler<
  z.infer<typeof sourceSyncTaskPayloadSchema>,
  z.infer<typeof sourceSyncTaskOutputSchema>
> {
  return {
    taskType: 'source.sync',
    payloadSchema: sourceSyncTaskPayloadSchema,
    outputSchema: sourceSyncTaskOutputSchema,
    defaultMaxAttempts: 3,
    leaseDurationMs: 10 * 60_000,
    concurrencyKey: (payload) => `source-sync:${payload.sourceId}`,
    /** 执行应用适配器的该项操作。 */
    async execute(context, payload) {
      const result = await service.run(
        { sourceId: parseId(payload.sourceId, 'JobSource'), trigger: payload.trigger },
        context.signal,
      );
      if (result.kind === 'conflict') {
        return { runId: result.runId, status: 'conflict', coverage: null };
      }
      if (
        result.status === 'failed' ||
        (result.status === 'partial' &&
          (result.errorCategory === 'temporary' || result.errorCategory === 'rate_limited'))
      ) {
        throw new TaskExecutionError(
          taskErrorCategory(result.errorCategory),
          result.errorSummary ?? 'Source synchronization failed.',
        );
      }
      if (result.status === 'cancelled') {
        throw new TaskExecutionError('cancelled', 'Source synchronization was cancelled.');
      }
      return {
        runId: result.runId,
        status: result.status,
        coverage: result.coverage,
      };
    },
  };
}
