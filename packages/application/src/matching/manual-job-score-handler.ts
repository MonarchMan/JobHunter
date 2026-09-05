import { z } from 'zod';
import { jobAdviceAgentDefinition, jobUnderstandingAgentDefinition } from '@jobhunter/matching';
import type { TaskHandler, TaskHandlerContext } from '../tasks/model.js';
import type { createJobAdviceTaskHandler } from './job-advice-handler.js';
import type { createJobUnderstandingTaskHandler } from './job-understanding-handler.js';
import type { createMatchRevisionTaskHandler } from './matching-handlers.js';
import { classifyTaskError, TaskExecutionError } from '../tasks/retry-policy.js';

/** 手动触发职位评分任务的输入。 */
export const manualJobScoreTaskPayloadSchema = z
  .object({
    jobRevisionId: z.string().trim().min(1),
    profileVersionId: z.string().trim().min(1),
    mode: z.enum(['rules', 'llm']),
    resumeMatchResultId: z.uuidv7().optional(),
  })
  .strict();

const outputSchema = z
  .object({
    mode: z.enum(['rules', 'llm']),
    matchResultId: z.string().trim().min(1),
    matchAdviceId: z.string().trim().min(1).nullable(),
  })
  .strict();

/** 建议失败的持久化检查点，评分结果已经提交，引用必须与任务输入一致。 */
const partialResultSchema = z
  .object({
    scoringStatus: z.literal('succeeded'),
    adviceStatus: z.literal('failed'),
    matchResultId: z.uuidv7(),
    jobRevisionId: z.string(),
    profileVersionId: z.string(),
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
    retryPayload: (value, result) => {
      const payload = manualJobScoreTaskPayloadSchema.parse(value);
      const partial = partialResultSchema.safeParse(result);
      // 1、只有同一职位和画像的评分检查点可以跳过已完成的阶段。
      if (
        payload.mode === 'llm' &&
        partial.success &&
        partial.data.jobRevisionId === payload.jobRevisionId &&
        partial.data.profileVersionId === payload.profileVersionId
      ) {
        return { ...payload, resumeMatchResultId: partial.data.matchResultId };
      }
      return payload;
    },
    /** 执行应用适配器的该项操作。 */
    async execute(context: TaskHandlerContext, payload) {
      let jobEnrichmentId: string | null = null;
      // 1、首次执行理解与评分；恢复任务直接使用已提交的评分 ID。
      if (payload.mode === 'llm' && !payload.resumeMatchResultId) {
        const enrichment = await input.understanding.execute(context, {
          jobRevisionId: payload.jobRevisionId,
          enrichmentVersion: jobUnderstandingAgentDefinition.version,
        });
        jobEnrichmentId = enrichment.jobEnrichmentId;
      }
      const matched =
        payload.mode === 'llm' && payload.resumeMatchResultId
          ? { matchResultId: payload.resumeMatchResultId }
          : await input.matching.execute(context, {
              jobRevisionId: payload.jobRevisionId,
              jobEnrichmentId,
              profileVersionId: payload.profileVersionId,
            });
      if (payload.mode === 'rules') {
        return { mode: payload.mode, matchResultId: matched.matchResultId, matchAdviceId: null };
      }
      // 2、建议失败不撤销评分；携带检查点让自动及手动重试只恢复建议。
      try {
        const advice = await input.advice.execute(context, {
          matchResultId: matched.matchResultId,
          adviceVersion: jobAdviceAgentDefinition.version,
          jobRevisionId: payload.jobRevisionId,
          profileVersionId: payload.profileVersionId,
        });
        return {
          mode: payload.mode,
          matchResultId: matched.matchResultId,
          matchAdviceId: advice.matchAdviceId,
        };
      } catch (error) {
        const classified = classifyTaskError(error);
        throw new TaskExecutionError(
          classified.category,
          `评分完成，${classified.safeSummary.startsWith('建议') ? classified.safeSummary : '建议生成失败：' + classified.safeSummary}`,
          {
            cause: error,
            ...(classified.retryable === null ? {} : { retryable: classified.retryable }),
            ...(classified.retryAfterAt === null ? {} : { retryAfterAt: classified.retryAfterAt }),
            result: partialResultSchema.parse({
              scoringStatus: 'succeeded',
              adviceStatus: 'failed',
              matchResultId: matched.matchResultId,
              jobRevisionId: payload.jobRevisionId,
              profileVersionId: payload.profileVersionId,
            }),
          },
        );
      }
    },
  };
}
