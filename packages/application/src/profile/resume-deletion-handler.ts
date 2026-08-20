import { z } from 'zod';
import type { TaskHandler } from '../tasks/model.js';
import { TaskExecutionError } from '../tasks/retry-policy.js';
import {
  ResumeDeletionConfirmationError,
  ResumeDeletionNotFoundError,
  type ResumeDeletionService,
} from './resume-deletion-service.js';

const deletionCountsSchema = z
  .object({
    profiles: z.number().int().nonnegative(),
    profileVersions: z.number().int().nonnegative(),
    resumeDocuments: z.number().int().nonnegative(),
    matchResults: z.number().int().nonnegative(),
    agentRuns: z.number().int().nonnegative(),
    artifacts: z.number().int().nonnegative(),
  })
  .strict();

export const resumeDeletionTaskPayloadSchema = z
  .object({
    resumeDocumentId: z.string().trim().min(1),
    expectedImpactHash: z.string().length(64),
  })
  .strict();

export const resumeDeletionTaskOutputSchema = z
  .object({
    impactHash: z.string().length(64),
    deleted: deletionCountsSchema,
    pendingArtifactPurgeIds: z.array(z.string()),
  })
  .strict();

export const artifactPurgeTaskPayloadSchema = z
  .object({ artifactId: z.string().trim().min(1) })
  .strict();

export const artifactPurgeTaskOutputSchema = z
  .object({ status: z.enum(['purged', 'already_purged']) })
  .strict();

export function createResumeDeletionTaskHandler(
  service: ResumeDeletionService,
): TaskHandler<
  z.infer<typeof resumeDeletionTaskPayloadSchema>,
  z.infer<typeof resumeDeletionTaskOutputSchema>
> {
  return {
    taskType: 'resume.delete.confirmed',
    payloadSchema: resumeDeletionTaskPayloadSchema,
    outputSchema: resumeDeletionTaskOutputSchema,
    defaultMaxAttempts: 3,
    leaseDurationMs: 120_000,
    concurrencyKey: (payload) => `resume-delete:${payload.resumeDocumentId}`,
    async execute(_context, payload) {
      try {
        const result = await service.deleteConfirmed(payload);
        return {
          ...result,
          pendingArtifactPurgeIds: [...result.pendingArtifactPurgeIds],
        };
      } catch (error) {
        if (
          error instanceof ResumeDeletionConfirmationError ||
          error instanceof ResumeDeletionNotFoundError
        ) {
          throw new TaskExecutionError('validation_failed', error.message, { cause: error });
        }
        throw new TaskExecutionError('io_temporary', 'Confirmed resume deletion failed.', {
          cause: error,
        });
      }
    },
  };
}

export function createArtifactPurgeTaskHandler(
  service: ResumeDeletionService,
): TaskHandler<
  z.infer<typeof artifactPurgeTaskPayloadSchema>,
  z.infer<typeof artifactPurgeTaskOutputSchema>
> {
  return {
    taskType: 'resume.artifact.purge',
    payloadSchema: artifactPurgeTaskPayloadSchema,
    outputSchema: artifactPurgeTaskOutputSchema,
    defaultMaxAttempts: 5,
    leaseDurationMs: 60_000,
    concurrencyKey: (payload) => `artifact-purge:${payload.artifactId}`,
    async execute(_context, payload) {
      try {
        return { status: await service.retryArtifactPurge(payload.artifactId) };
      } catch (error) {
        throw new TaskExecutionError('io_temporary', 'Deleted resume artifact purge failed.', {
          cause: error,
        });
      }
    },
  };
}
