import { parseId, utcInstant } from '@jobhunter/domain';
import { SourceError } from '@jobhunter/source-core';
import { z } from 'zod';
import type { TaskErrorCategory, TaskHandler } from '../tasks/model.js';
import { TaskExecutionError } from '../tasks/retry-policy.js';
import type { JobSyncService } from './job-sync-service.js';

/** 来源同步任务输入。 */
export const sourceSyncTaskPayloadSchema = z.union([
  z
    .object({
      sourceId: z.string().trim().min(1),
      trigger: z.enum(['manual', 'schedule', 'retry']),
    })
    .strict(),
  z
    .object({
      sourceIds: z.array(z.string().trim().min(1)).min(2).max(10),
      trigger: z.enum(['manual', 'schedule', 'retry']),
    })
    .refine((payload) => new Set(payload.sourceIds).size === payload.sourceIds.length)
    .strict(),
]);

/** 来源同步任务输出统计。 */
const sourceSyncRunOutputSchema = z
  .object({
    sourceId: z.string().trim().min(1),
    runId: z.string().trim().min(1),
    status: z.enum(['succeeded', 'partial', 'failed', 'cancelled', 'conflict']),
    coverage: z.enum(['complete', 'partial', 'unknown']).nullable(),
  })
  .strict();

export const sourceSyncTaskOutputSchema = z.union([
  z
    .object({
      runId: z.string().trim().min(1),
      status: z.enum(['succeeded', 'partial', 'failed', 'cancelled', 'conflict']),
      coverage: z.enum(['complete', 'partial', 'unknown']).nullable(),
    })
    .strict(),
  z.object({ runs: z.array(sourceSyncRunOutputSchema).min(2).max(10) }).strict(),
]);

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
    concurrencyKey: (payload) =>
      `source-sync:${'sourceId' in payload ? payload.sourceId : [...payload.sourceIds].sort().join('|')}`,
    /** 执行应用适配器的该项操作。 */
    async execute(context, payload) {
      if ('sourceId' in payload) {
        let result: Awaited<ReturnType<JobSyncService['run']>>;
        try {
          result = await service.run(
            { sourceId: parseId(payload.sourceId, 'JobSource'), trigger: payload.trigger },
            context.signal,
          );
        } catch (error) {
          if (error instanceof SourceError) {
            throw new TaskExecutionError(taskErrorCategory(error.category), error.safeDiagnostic, {
              cause: error,
              ...(error.retryAfterAt === null
                ? {}
                : { retryAfterAt: utcInstant(error.retryAfterAt) }),
            });
          }
          throw error;
        }
        if (result.kind === 'conflict') {
          return { runId: result.runId, status: 'conflict', coverage: null };
        }
        if (
          result.status === 'failed' ||
          (result.status === 'partial' &&
            (result.errorCategory === 'temporary' ||
              result.errorCategory === 'rate_limited' ||
              result.failureCause !== undefined))
        ) {
          throw new TaskExecutionError(
            taskErrorCategory(result.errorCategory),
            result.errorSummary ?? 'Source synchronization failed.',
            { cause: result.failureCause },
          );
        }
        if (result.status === 'cancelled') {
          throw new TaskExecutionError('cancelled', 'Source synchronization was cancelled.');
        }
        return { runId: result.runId, status: result.status, coverage: result.coverage };
      }
      // 1、按顺序完成聚合 payload 中的全部来源。
      const sourceIds = payload.sourceIds;
      const runs: {
        sourceId: string;
        runId: string;
        status: 'succeeded' | 'partial' | 'failed' | 'cancelled' | 'conflict';
        coverage: 'complete' | 'partial' | 'unknown' | null;
      }[] = [];
      const failures: { sourceId: string; error: unknown }[] = [];
      for (const sourceId of sourceIds) {
        context.signal.throwIfAborted();
        try {
          const result = await service.run(
            { sourceId: parseId(sourceId, 'JobSource'), trigger: payload.trigger },
            context.signal,
          );
          const run =
            result.kind === 'conflict'
              ? { sourceId, runId: result.runId, status: 'conflict' as const, coverage: null }
              : { sourceId, runId: result.runId, status: result.status, coverage: result.coverage };
          runs.push(run);
          if (result.kind === 'completed' && result.status === 'cancelled')
            throw new TaskExecutionError('cancelled', 'Source synchronization was cancelled.');
          if (
            result.kind === 'completed' &&
            (result.status === 'failed' ||
              (result.status === 'partial' &&
                (result.errorCategory === 'temporary' ||
                  result.errorCategory === 'rate_limited' ||
                  result.failureCause !== undefined)))
          ) {
            throw new TaskExecutionError(
              taskErrorCategory(result.errorCategory),
              result.errorSummary ?? 'Source synchronization failed.',
              { cause: result.failureCause },
            );
          }
        } catch (error) {
          if (error instanceof TaskExecutionError && error.category === 'cancelled') throw error;
          if (error instanceof SourceError) {
            failures.push({
              sourceId,
              error: new TaskExecutionError(
                taskErrorCategory(error.category),
                error.safeDiagnostic,
                {
                  cause: error,
                  ...(error.retryAfterAt === null
                    ? {}
                    : { retryAfterAt: utcInstant(error.retryAfterAt) }),
                },
              ),
            });
          } else failures.push({ sourceId, error });
        }
      }
      // 2、聚合运行全部结束后再失败，使同一任务重试时不会漏掉第二来源。
      if (failures.length) {
        const first = failures[0]!.error;
        if (first instanceof TaskExecutionError) throw first;
        throw first;
      }
      return { runs };
    },
  };
}
