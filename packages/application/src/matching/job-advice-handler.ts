import { AgentRuntimeError, type AgentRunner } from '@jobhunter/agent-core';
import { contentHash, parseId, type Clock, type IdGenerator } from '@jobhunter/domain';
import { jobAdviceAgentDefinition, parseJobAdviceAgentOutput } from '@jobhunter/matching';
import { z } from 'zod';
import { mapAgentRuntimeError } from '../agents/error-mapping.js';
import type { MatchingRepository } from '../ports/matching.js';
import type { CandidateProfileRepository } from '../ports/profiles.js';
import type { TaskHandler } from '../tasks/model.js';
import { TaskExecutionError } from '../tasks/retry-policy.js';

export const jobAdviceTaskPayloadSchema = z
  .object({
    matchResultId: z.string().trim().min(1),
    adviceVersion: z.string().trim().min(1),
  })
  .strict();

export const jobAdviceTaskOutputSchema = z
  .object({
    matchAdviceId: z.string().trim().min(1),
    agentRunId: z.string().trim().min(1),
    cacheHit: z.boolean(),
  })
  .strict();

export function createJobAdviceTaskHandler(
  input:
    | {
        readonly runner: AgentRunner;
        readonly matching: MatchingRepository;
        readonly profiles: CandidateProfileRepository;
        readonly clock: Clock;
        readonly ids: IdGenerator;
      }
    | { readonly unavailable: true },
): TaskHandler<
  z.infer<typeof jobAdviceTaskPayloadSchema>,
  z.infer<typeof jobAdviceTaskOutputSchema>
> {
  return {
    taskType: 'match.advise',
    payloadSchema: jobAdviceTaskPayloadSchema,
    outputSchema: jobAdviceTaskOutputSchema,
    defaultMaxAttempts: 3,
    leaseDurationMs: 120_000,
    concurrencyKey: (payload) => `match-advice:${payload.matchResultId}:${payload.adviceVersion}`,
    async execute(context, payload) {
      if ('unavailable' in input) {
        throw new TaskExecutionError('invalid_config', 'Job advice model is not configured.');
      }
      if (payload.adviceVersion !== jobAdviceAgentDefinition.version) {
        throw new TaskExecutionError(
          'invalid_config',
          'Queued job advice version is no longer active.',
        );
      }
      const match = input.matching.getMatch(parseId(payload.matchResultId, 'MatchResult'));
      if (!match) throw new TaskExecutionError('validation_failed', 'Match result does not exist.');
      const profile = input.profiles.getVersion(match.profileVersionId);
      const revision = input.matching.getRevision(match.jobRevisionId);
      if (!profile || !revision) {
        throw new TaskExecutionError('validation_failed', 'Match advice inputs do not exist.');
      }
      const agentInput = {
        profile: profile.effective,
        job: revision.normalized,
        match: {
          filterStatus: match.filterStatus,
          totalScore: match.totalScore,
          components: match.components,
          ruleOutcomes: match.ruleOutcomes,
        },
      };
      try {
        const result = await input.runner.run({
          definition: jobAdviceAgentDefinition,
          value: agentInput,
          signal: context.signal,
        });
        const output = parseJobAdviceAgentOutput(result.output, agentInput);
        const stored = input.matching.saveAdvice({
          id: parseId(input.ids.generate(), 'MatchAdvice'),
          matchResultId: match.id,
          agentRunId: result.run.id,
          schemaVersion: jobAdviceAgentDefinition.outputSchemaVersion,
          contentHash: contentHash(output),
          result: output,
          createdAt: input.clock.now(),
        });
        return { matchAdviceId: stored.id, agentRunId: result.run.id, cacheHit: result.cacheHit };
      } catch (error) {
        if (error instanceof AgentRuntimeError) {
          throw mapAgentRuntimeError(error, 'Job advice Agent');
        }
        throw error;
      }
    },
  };
}
