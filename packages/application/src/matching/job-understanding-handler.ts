import { AgentRuntimeError, type AgentRunner } from '@jobhunter/agent-core';
import { contentHash, parseId, type Clock, type IdGenerator } from '@jobhunter/domain';
import {
  jobUnderstandingAgentDefinition,
  parseJobUnderstandingAgentOutput,
} from '@jobhunter/matching';
import { z } from 'zod';
import { mapAgentRuntimeError } from '../agents/error-mapping.js';
import type { MatchingRepository } from '../ports/matching.js';
import type { TaskHandler } from '../tasks/model.js';
import { TaskExecutionError } from '../tasks/retry-policy.js';

export const jobUnderstandingTaskPayloadSchema = z
  .object({
    jobRevisionId: z.string().trim().min(1),
    enrichmentVersion: z.string().trim().min(1),
  })
  .strict();

export const jobUnderstandingTaskOutputSchema = z
  .object({
    jobEnrichmentId: z.string().trim().min(1),
    agentRunId: z.string().trim().min(1),
    cacheHit: z.boolean(),
  })
  .strict();

export function createJobUnderstandingTaskHandler(
  input:
    | {
        readonly runner: AgentRunner;
        readonly matching: MatchingRepository;
        readonly clock: Clock;
        readonly ids: IdGenerator;
        readonly onEnrichmentStored?: (
          enrichment: ReturnType<MatchingRepository['saveEnrichment']>,
        ) => void;
      }
    | { readonly unavailable: true },
): TaskHandler<
  z.infer<typeof jobUnderstandingTaskPayloadSchema>,
  z.infer<typeof jobUnderstandingTaskOutputSchema>
> {
  return {
    taskType: 'job.enrich',
    payloadSchema: jobUnderstandingTaskPayloadSchema,
    outputSchema: jobUnderstandingTaskOutputSchema,
    defaultMaxAttempts: 3,
    leaseDurationMs: 120_000,
    concurrencyKey: (payload) => `job-enrich:${payload.jobRevisionId}`,
    async execute(context, payload) {
      if ('unavailable' in input) {
        throw new TaskExecutionError('invalid_config', 'Job enrichment model is not configured.');
      }
      if (payload.enrichmentVersion !== jobUnderstandingAgentDefinition.version) {
        throw new TaskExecutionError(
          'invalid_config',
          'Queued job enrichment version is no longer active.',
        );
      }
      const revision = input.matching.getRevision(parseId(payload.jobRevisionId, 'JobRevision'));
      if (!revision) {
        throw new TaskExecutionError('validation_failed', 'Job revision does not exist.');
      }
      const agentInput = {
        title: revision.normalized.title,
        description: revision.normalized.description,
        experienceText: revision.normalized.experienceText,
        educationText: revision.normalized.educationText,
      };
      try {
        const result = await input.runner.run({
          definition: jobUnderstandingAgentDefinition,
          value: agentInput,
          signal: context.signal,
        });
        const understanding = parseJobUnderstandingAgentOutput(result.output, agentInput);
        const stored = input.matching.saveEnrichment({
          id: parseId(input.ids.generate(), 'JobEnrichment'),
          jobRevisionId: revision.id,
          agentRunId: result.run.id,
          schemaVersion: jobUnderstandingAgentDefinition.outputSchemaVersion,
          contentHash: contentHash(understanding),
          result: understanding,
          createdAt: input.clock.now(),
        });
        input.onEnrichmentStored?.(stored);
        return {
          jobEnrichmentId: stored.id,
          agentRunId: result.run.id,
          cacheHit: result.cacheHit,
        };
      } catch (error) {
        if (error instanceof AgentRuntimeError) {
          throw mapAgentRuntimeError(error, 'Job understanding Agent');
        }
        throw error;
      }
    },
  };
}
