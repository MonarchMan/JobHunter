import { z } from 'zod';
import { jobAdviceAgentDefinition, jobUnderstandingAgentDefinition } from '@jobhunter/matching';
import type { TaskHandler, TaskHandlerContext } from '../tasks/model.js';
import type { createJobAdviceTaskHandler } from './job-advice-handler.js';
import type { createJobUnderstandingTaskHandler } from './job-understanding-handler.js';
import type { createMatchRevisionTaskHandler } from './matching-handlers.js';

/** 手动触发职位评分任务的输入。 */
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

/** 应用层使用的类型约束。 */
type UnderstandingHandler = ReturnType<typeof createJobUnderstandingTaskHandler>;
/** 应用层使用的类型约束。 */
type MatchingHandler = ReturnType<typeof createMatchRevisionTaskHandler>;
/** 应用层使用的类型约束。 */
type AdviceHandler = ReturnType<typeof createJobAdviceTaskHandler>;

/** 创建串联职位理解、匹配和建议的手动评分处理器。 */
export function createManualJobScoreTaskHandler(input: {
  // 1、校验任务输入；2、依次执行理解/匹配/建议；3、汇总子任务结果。
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
    /** 执行应用适配器的该项操作。 */
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
