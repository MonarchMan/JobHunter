import { z } from 'zod';
import type { TaskHandler } from '../tasks/model.js';
import { TaskExecutionError } from '../tasks/retry-policy.js';
import type { CleanupService } from './cleanup-service.js';

/** 清理任务输入。 */
export const cleanupTaskPayloadSchema = z
  .object({
    sourceDetailsDays: z.number().int().min(1).max(3_650),
    observationsDays: z.number().int().min(1).max(3_650),
    failedAgentRunsDays: z.number().int().min(1).max(3_650),
  })
  .strict();

/** 清理任务输出。 */
export const cleanupTaskOutputSchema = z
  .object({
    deleted: z.number().int().nonnegative(),
    bytes: z.number().int().nonnegative(),
  })
  .strict();

/** 创建清理任务处理器。 */
export function createCleanupTaskHandler(
  input: { readonly cleanup: CleanupService } | { readonly unavailable: true },
): TaskHandler<z.infer<typeof cleanupTaskPayloadSchema>, z.infer<typeof cleanupTaskOutputSchema>> {
  return {
    taskType: 'maintenance.cleanup',
    payloadSchema: cleanupTaskPayloadSchema,
    outputSchema: cleanupTaskOutputSchema,
    defaultMaxAttempts: 2,
    leaseDurationMs: 180_000,
    concurrencyKey: () => 'maintenance:cleanup',
    /** 执行应用适配器的该项操作。 */
    async execute(context, payload) {
      if ('unavailable' in input) {
        throw new TaskExecutionError('invalid_config', 'Cleanup service is not configured.');
      }
      const plan = await input.cleanup.plan(payload, { now: context.clock.now() });
      return input.cleanup.execute(plan.confirmationToken, { now: context.clock.now() });
    },
  };
}
