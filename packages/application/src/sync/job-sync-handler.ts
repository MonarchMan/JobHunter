import { parseId } from '@jobhunter/domain';
import { z } from 'zod';
import type { TaskHandler } from '../tasks/model.js';
import { TaskExecutionError } from '../tasks/retry-policy.js';
import type { JobSyncService } from './job-sync-service.js';

export const sourceSyncTaskPayloadSchema = z
  .object({
    sourceId: z.string().trim().min(1),
    trigger: z.enum(['manual', 'schedule', 'retry']),
  })
  .strict();

export const sourceSyncTaskOutputSchema = z
  .object({
    runId: z.string().trim().min(1),
    status: z.enum(['succeeded', 'partial', 'failed', 'cancelled', 'conflict']),
    coverage: z.enum(['complete', 'partial', 'unknown']).nullable(),
  })
  .strict();

export function createSourceSyncTaskHandler(
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
    async execute(context, payload) {
      const result = await service.run(
        { sourceId: parseId(payload.sourceId, 'JobSource'), trigger: payload.trigger },
        context.signal,
      );
      if (result.kind === 'conflict') {
        return { runId: result.runId, status: 'conflict', coverage: null };
      }
      if (result.status === 'failed') {
        throw new TaskExecutionError('permanent', 'Source synchronization failed.');
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
