import { z } from 'zod';
import { TaskExecutionError, type TaskHandler } from '@jobhunter/common/tasks';
import type { createJobAnalysis } from './job-analysis.js';
import type { createMatchRevisionTaskHandler } from './matching-handlers.js';
/** 单职位评分统一完成分析、规则汇总和建议保存，不再维护独立建议阶段。 */
export const manualJobScoreTaskPayloadSchema = z
  .object({
    jobRevisionId: z.string().trim().min(1),
    profileVersionId: z.string().trim().min(1),
    mode: z.enum(['rules', 'llm']),
    requireModelScore: z.boolean().optional(),
  })
  .strict();
const outputSchema = z
  .object({
    mode: z.enum(['rules', 'llm']),
    matchResultId: z.string(),
    matchAdviceId: z.string().nullable(),
    modelScoreMissing: z.boolean().nullable(),
  })
  .strict();
/** 只调用一次分析用例；开关在开始执行时读取并固定于本次输入。 */
export function createManualJobScoreTaskHandler(input: {
  readonly analysis: ReturnType<typeof createJobAnalysis>;
  readonly matching: ReturnType<typeof createMatchRevisionTaskHandler>;
  readonly adviceEnabled: () => boolean;
}): TaskHandler<z.infer<typeof manualJobScoreTaskPayloadSchema>, z.infer<typeof outputSchema>> {
  return {
    taskType: 'match.score-job',
    payloadSchema: manualJobScoreTaskPayloadSchema,
    outputSchema,
    defaultMaxAttempts: 3,
    leaseDurationMs: 300_000,
    concurrencyKey: (payload) =>
      'match-score:' + payload.jobRevisionId + ':' + payload.profileVersionId,
    async execute(context, payload) {
      // 1、冻结输出开关，一次取得本次所需的全部模型内容。
      const analysis = await input.analysis.analyze(context, {
        jobRevisionId: payload.jobRevisionId,
        profileVersionId: payload.profileVersionId,
        score: payload.mode === 'llm',
        advice: input.adviceEnabled(),
      });
      if (payload.requireModelScore && payload.mode === 'llm' && analysis.fitScore === null)
        throw new TaskExecutionError(
          'permanent',
          '模型评分未完成，请检查模型配置或运行错误后重试。',
        );
      // 2、规则只汇总确定性结果，建议不依赖最终分数。
      const matched = await input.matching.execute(context, {
        jobRevisionId: payload.jobRevisionId,
        profileVersionId: payload.profileVersionId,
        jobEnrichmentId: analysis.jobEnrichmentId,
        modelScore: analysis.fitScore,
        modelReasons: [...analysis.fitReasons],
      });
      // 3、各类元数据保留独立语义，共享同一模型运行身份。
      return {
        mode: payload.mode,
        matchResultId: matched.matchResultId,
        matchAdviceId: input.analysis.storeAdvice(matched.matchResultId, analysis),
        modelScoreMissing: payload.mode === 'llm' ? analysis.fitScore === null : null,
      };
    },
  };
}
