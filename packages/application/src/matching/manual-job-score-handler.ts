import { z } from 'zod';
import { jobAdviceAgentDefinition, jobUnderstandingAgentDefinition } from '@jobhunter/matching';
import type { TaskHandler, TaskHandlerContext } from '../tasks/model.js';
import type { createJobAdviceTaskHandler } from './job-advice-handler.js';
import type { createJobUnderstandingTaskHandler } from './job-understanding-handler.js';
import type { createMatchRevisionTaskHandler } from './matching-handlers.js';

export const manualJobScoreTaskPayloadSchema = z
  .object({
    jobRevisionId: z.string().trim().min(1),
    profileVersionId: z.string().trim().min(1),
    mode: z.enum(['rules', 'llm']),
  })
  .strict();

const outputSchema = z
  .object({
    mode: z.enum(['rules', 'llm']),
    matchResultId: z.string().trim().min(1),
    matchAdviceId: z.string().trim().min(1).nullable(),
  })
  .strict();

type UnderstandingHandler = ReturnType<typeof createJobUnderstandingTaskHandler>;
type MatchingHandler = ReturnType<typeof createMatchRevisionTaskHandler>;
type AdviceHandler = ReturnType<typeof createJobAdviceTaskHandler>;

export function createManualJobScoreTaskHandler(input: {
  readonly understanding: UnderstandingHandler;
  readonly matching: MatchingHandler;
  readonly advice: AdviceHandler;
}): TaskHandler<z.infer<typeof manualJobScoreTaskPayloadSchema>, z.infer<typeof outputSchema>> {
  return {
    taskType: 'match.score-job',
    payloadSchema: manualJobScoreTaskPayloadSchema,
    outputSchema,
    defaultMaxAttempts: 3,
    leaseDurationMs: 300_000,
    concurrencyKey: (payload) => `match-score:${payload.jobRevisionId}:${payload.profileVersionId}`,
    async execute(context: TaskHandlerContext, payload) {
      let jobEnrichmentId: string | null = null;
      if (payload.mode === 'llm') {
        const enrichment = await input.understanding.execute(context, {
          jobRevisionId: payload.jobRevisionId,
          enrichmentVersion: jobUnderstandingAgentDefinition.version,
        });
        jobEnrichmentId = enrichment.jobEnrichmentId;
      }
      const matched = await input.matching.execute(context, {
        jobRevisionId: payload.jobRevisionId,
        jobEnrichmentId,
        profileVersionId: payload.profileVersionId,
      });
      if (payload.mode === 'rules') {
        return { mode: payload.mode, matchResultId: matched.matchResultId, matchAdviceId: null };
      }
      const advice = await input.advice.execute(context, {
        matchResultId: matched.matchResultId,
        adviceVersion: jobAdviceAgentDefinition.version,
      });
      return {
        mode: payload.mode,
        matchResultId: matched.matchResultId,
        matchAdviceId: advice.matchAdviceId,
      };
    },
  };
}
