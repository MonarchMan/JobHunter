import { parseId } from '@jobhunter/domain';
import { z } from 'zod';
import type { TaskHandler } from '../tasks/model.js';
import type { MatchingBatchService, MatchBatchResult } from './matching-batch-service.js';

// Agent 任务输出在持久化前统一通过 Schema 校验。
const outputSchema = z
  .object({
    matchResultId: z.string().trim().min(1),
    processedInputs: z.number().int().nonnegative(),
    createdResults: z.number().int().nonnegative(),
    existingResults: z.number().int().nonnegative(),
  })
  .strict();

/** 匹配修订任务的输入，绑定职位修订和简历版本。 */
export const matchRevisionTaskPayloadSchema = z
  .object({
    jobRevisionId: z.string().trim().min(1),
    jobEnrichmentId: z.string().trim().min(1).nullable(),
    profileVersionId: z.string().trim().min(1),
  })
  .strict();

/** 创建匹配任务处理器，执行确定性评分并写入匹配结果。 */
export function createMatchRevisionTaskHandler(
  batches: MatchingBatchService | null,
): TaskHandler<z.infer<typeof matchRevisionTaskPayloadSchema>, MatchBatchResult> {
  return {
    taskType: 'match.compute-revision',
    payloadSchema: matchRevisionTaskPayloadSchema,
    outputSchema,
    defaultMaxAttempts: 2,
    leaseDurationMs: 180_000,
    concurrencyKey: (payload) =>
      `match-revision:${payload.jobRevisionId}:${payload.jobEnrichmentId ?? 'none'}`,
    execute: (context, payload) => {
      if (!batches) return Promise.reject(new TypeError('Matching service is not available.'));
      return batches.forRevision({
        jobRevisionId: parseId(payload.jobRevisionId, 'JobRevision'),
        jobEnrichmentId:
          payload.jobEnrichmentId === null
            ? null
            : parseId(payload.jobEnrichmentId, 'JobEnrichment'),
        profileVersionId: parseId(payload.profileVersionId, 'ProfileVersion'),
        signal: context.signal,
      });
    },
  };
}
