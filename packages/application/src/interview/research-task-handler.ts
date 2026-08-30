import { parseId } from '@jobhunter/domain';
import { z } from 'zod';
import type { ExternalResearchExecutor } from '../ports/external-research.js';
import { ExternalResearchExecutorError } from '../ports/external-research.js';
import type { InterviewResearchRepository } from '../ports/interview-research.js';
import type { TaskHandler } from '../tasks/model.js';
import { TaskExecutionError } from '../tasks/retry-policy.js';
import type { ExperienceResearchService } from './research-service.js';

export const experienceResearchTaskPayloadSchema = z
  .object({
    requestId: z.uuid(),
    requestFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    expectedRevision: z.number().int().nonnegative(),
    executorKey: z.literal('codex-local'),
  })
  .strict();

export const experienceResearchTaskOutputSchema = z
  .object({
    requestId: z.uuid(),
    bundleFileId: z.string().regex(/^[0-9a-f]{64}$/),
    bundleFileVersionNo: z.number().int().min(1).max(5),
    candidateCount: z.number().int().nonnegative(),
    externalSessionId: z.string().max(500).nullable(),
  })
  .strict();

export function createExperienceResearchTaskHandler(
  input:
    | {
        readonly repository: InterviewResearchRepository;
        readonly service: ExperienceResearchService;
        readonly executor: ExternalResearchExecutor;
      }
    | { readonly unavailable: true },
): TaskHandler<
  z.infer<typeof experienceResearchTaskPayloadSchema>,
  z.infer<typeof experienceResearchTaskOutputSchema>
> {
  return {
    taskType: 'interview.experience-research.execute',
    payloadSchema: experienceResearchTaskPayloadSchema,
    outputSchema: experienceResearchTaskOutputSchema,
    defaultMaxAttempts: 2,
    leaseDurationMs: 20 * 60_000,
    lateCancellationPolicy: 'complete',
    concurrencyKey: (payload) => `experience-research:${payload.requestId}`,
    async execute(context, payload) {
      if ('unavailable' in input) {
        throw new TaskExecutionError('invalid_config', 'Local research executor is unavailable.');
      }
      const requestId = parseId(payload.requestId, 'ExperienceResearchRequest');
      const detail = input.repository.getRequest(requestId);
      if (
        detail?.request.requestFingerprint !== payload.requestFingerprint ||
        detail.request.revision !== payload.expectedRevision ||
        detail.request.state !== 'ready' ||
        (context.taskId !== undefined && detail.request.currentTaskId !== context.taskId) ||
        input.executor.key !== payload.executorKey
      ) {
        throw new TaskExecutionError('cancelled', 'Research request context is stale.');
      }
      try {
        const [prompt, outputSchema] = await Promise.all([
          input.service.prompt(requestId, context.signal),
          input.service.schema(requestId, context.signal),
        ]);
        const result = await input.executor.execute(
          {
            requestId,
            prompt,
            outputSchema,
            maximumOutputBytes: 2 * 1024 * 1024,
            timeoutMs: 15 * 60_000,
          },
          context.signal,
        );
        const imported = await input.service.importBundle({
          requestId,
          expectedRevision: payload.expectedRevision,
          bytes: new TextEncoder().encode(result.bundleText),
          ...(context.taskId === undefined ? {} : { taskId: context.taskId }),
          signal: context.signal,
        });
        if (!imported.request.bundleFileId || !imported.request.bundleFileVersionNo) {
          throw new TaskExecutionError('validation_failed', 'Research bundle was not persisted.');
        }
        return {
          requestId,
          bundleFileId: imported.request.bundleFileId,
          bundleFileVersionNo: imported.request.bundleFileVersionNo,
          candidateCount: imported.experiences.length,
          externalSessionId: result.externalSessionId,
        };
      } catch (error) {
        if (error instanceof TaskExecutionError) throw error;
        if (
          context.signal.aborted ||
          (error instanceof DOMException && error.name === 'AbortError')
        ) {
          throw new TaskExecutionError('cancelled', 'Research execution was cancelled.', {
            cause: error,
          });
        }
        if (error instanceof ExternalResearchExecutorError) {
          const category =
            error.category === 'missing' || error.category === 'invalid_config'
              ? 'invalid_config'
              : error.category === 'temporary'
                ? 'io_temporary'
                : error.category === 'cancelled'
                  ? 'cancelled'
                  : 'permanent';
          throw new TaskExecutionError(category, error.message, { cause: error });
        }
        throw new TaskExecutionError(
          'validation_failed',
          'External research result was rejected.',
          {
            cause: error,
          },
        );
      }
    },
  };
}
