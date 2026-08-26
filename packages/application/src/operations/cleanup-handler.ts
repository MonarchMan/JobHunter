import { z } from 'zod';
import type { TaskHandler } from '../tasks/model.js';
import { TaskExecutionError } from '../tasks/retry-policy.js';
import type { CleanupService } from './cleanup-service.js';

export const cleanupTaskPayloadSchema = z
  .object({
    rawRecordsDays: z.number().int().min(1).max(3_650),
    observationsDays: z.number().int().min(1).max(3_650),
    failedAgentRunsDays: z.number().int().min(1).max(3_650),
  })
  .strict();

export const cleanupTaskOutputSchema = z
  .object({
    deleted: z.number().int().nonnegative(),
    bytes: z.number().int().nonnegative(),
  })
  .strict();

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
    async execute(context, payload) {
      if ('unavailable' in input) {
        throw new TaskExecutionError('invalid_config', 'Cleanup service is not configured.');
      }
      const plan = await input.cleanup.plan(payload, { now: context.clock.now() });
      return input.cleanup.execute(plan.confirmationToken, { now: context.clock.now() });
    },
  };
}
