import { parseContentHash, parseId } from '@jobhunter/common/domain';
import { isSourceError } from '@jobhunter/recruitment/source-contracts';
import { z } from 'zod';
import { TaskExecutionError, type TaskHandler } from '@jobhunter/common/tasks';
import type { JobDetailService } from './job-detail-service.js';
import { sourceTaskErrors } from './source-task-error.js';

/** 职位详情补抓任务输入。 */
export const sourceJobDetailTaskPayloadSchema = z
  .object({
    sourceId: z.string().trim().min(1),
    runId: z.string().trim().min(1),
    listContentHash: z.string().trim().min(1),
    adapterVersion: z.string().trim().min(1),
    discovered: z
      .object({
        externalJobId: z.string().min(1),
        sourceUrl: z.url({ protocol: /^https$/ }),
        raw: z.unknown(),
      })
      .strict(),
  })
  .strict();

/** 创建职位详情补抓任务处理器。 */
export function createSourceJobDetailTaskHandler(
  service: Pick<JobDetailService, 'run'>,
): TaskHandler<z.infer<typeof sourceJobDetailTaskPayloadSchema>, void> {
  return {
    taskType: 'source.job-detail',
    payloadSchema: sourceJobDetailTaskPayloadSchema,
    outputSchema: {
      parse(value: unknown): void {
        if (value !== undefined) throw new TypeError('Detail task must not return a value.');
      },
    },
    defaultMaxAttempts: 3,
    leaseDurationMs: 2 * 60_000,
    concurrencyKey: (payload) =>
      `source-detail:${payload.sourceId}:${payload.discovered.externalJobId}`,
    /** 执行应用适配器的该项操作。 */
    async execute(context, payload) {
      try {
        await service.run(
          {
            sourceId: parseId(payload.sourceId, 'JobSource'),
            runId: parseId(payload.runId, 'SyncRun'),
            listContentHash: parseContentHash(payload.listContentHash),
            adapterVersion: payload.adapterVersion,
            discovered: payload.discovered,
          },
          context.signal,
        );
      } catch (error) {
        if (isSourceError(error)) {
          // 1、普通来源错误交由通用重试策略按类别判断；解析变化仍保留原有重试行为。
          throw new TaskExecutionError(
            sourceTaskErrors.get(error.category) ?? 'permanent',
            error.safeDiagnostic,
            {
              ...(error.category === 'parse_changed' ? { retryable: true } : {}),
              cause: error,
            },
          );
        }
        throw error;
      }
    },
  };
}
