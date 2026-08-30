import { parseId } from '@jobhunter/domain';
import { z } from 'zod';
import type {
  ExternalResearchBrowserPolicy,
  ExternalResearchExecutor,
  ExternalResearchExecutorKey,
} from '../ports/external-research.js';
import { ExternalResearchExecutorError } from '../ports/external-research.js';
import type { InterviewResearchRepository } from '../ports/interview-research.js';
import type { TaskHandler } from '../tasks/model.js';
import { TaskExecutionError } from '../tasks/retry-policy.js';
import type { ExperienceResearchService } from './research-service.js';
import { createCommunityResearchCollectionPlan } from './research-collection-plan.js';

export const experienceResearchTaskPayloadSchema = z
  .object({
    requestId: z.uuid(),
    requestFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    expectedRevision: z.number().int().nonnegative(),
    executorKey: z.enum(['codex-local', 'browser-assisted-codex']),
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
        readonly executors: readonly ExternalResearchExecutor[];
      }
    | { readonly unavailable: true },
): TaskHandler<
  z.infer<typeof experienceResearchTaskPayloadSchema>,
  z.infer<typeof experienceResearchTaskOutputSchema>
> {
  const executors = new Map<ExternalResearchExecutorKey, ExternalResearchExecutor>();
  if (!('unavailable' in input)) {
    for (const executor of input.executors) {
      if (executors.has(executor.key)) {
        throw new TypeError(`Duplicate external research executor: ${executor.key}`);
      }
      executors.set(executor.key, executor);
    }
  }
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
      const executor = executors.get(payload.executorKey);
      if (
        detail?.request.requestFingerprint !== payload.requestFingerprint ||
        detail.request.revision !== payload.expectedRevision ||
        detail.request.state !== 'ready' ||
        (context.taskId !== undefined && detail.request.currentTaskId !== context.taskId)
      ) {
        throw new TaskExecutionError('cancelled', 'Research request context is stale.');
      }
      if (!executor) {
        throw new TaskExecutionError(
          'invalid_config',
          `Research executor ${payload.executorKey} is unavailable.`,
        );
      }
      if (!executor.supportedPromptVersions.includes(detail.request.promptVersion)) {
        throw new TaskExecutionError(
          'invalid_config',
          `Research executor ${executor.key} does not support frozen prompt ${detail.request.promptVersion}.`,
        );
      }
      try {
        const [prompt, outputSchema] = await Promise.all([
          input.service.prompt(requestId, context.signal),
          input.service.schema(requestId, context.signal),
        ]);
        const maximumSearches = Math.min(
          10,
          Math.max(3, Math.ceil(detail.request.brief.maxSources / 2)),
        );
        const maximumPages = Math.min(20, Math.max(5, detail.request.brief.maxSources * 2));
        const browserPolicy: ExternalResearchBrowserPolicy = {
          allowedDomains: detail.request.brief.allowedDomains,
          blockedDomains: detail.request.brief.blockedDomains,
          maximumSearches,
          maximumPages,
          maximumReadCalls: maximumPages,
          maximumPageCharacters: 40_000,
          maximumTotalCharacters: Math.min(200_000, detail.request.brief.maxSources * 40_000),
          navigationTimeoutMs: 20_000,
        };
        const result = await executor.execute(
          {
            requestId,
            promptVersion: detail.request.promptVersion,
            prompt,
            outputSchema,
            collectionPlan: createCommunityResearchCollectionPlan(
              detail.request.brief,
              maximumSearches,
            ),
            browserPolicy,
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
