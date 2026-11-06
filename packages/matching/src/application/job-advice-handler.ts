import { AgentRuntimeError, type AgentRunner } from '@jobhunter/common/agent';
import { contentHash, parseId, type Clock, type IdGenerator } from '@jobhunter/common/domain';
import { jobAdviceAgentDefinition, parseJobAdviceAgentOutput } from '../agents/job-advice-agent.js';
import { z } from 'zod';
import { mapAgentRuntimeError } from '@jobhunter/common/tasks';
import type { MatchingRepository } from '../ports/matching.js';
import type { CandidateProfileReader } from '@jobhunter/user/contracts';
import { TaskExecutionError, type TaskHandler } from '@jobhunter/common/tasks';

/** 职位准备建议任务输入。 */
export const jobAdviceTaskPayloadSchema = z
  .object({
    matchResultId: z.string().trim().min(1),
    jobRevisionId: z.string().optional(),
    profileVersionId: z.string().optional(),
  })
  .strict();

/** 职位准备建议任务输出。 */
export const jobAdviceTaskOutputSchema = z
  .object({
    matchAdviceId: z.string().trim().min(1),
    agentRunId: z.string().trim().min(1),
    cacheHit: z.boolean(),
  })
  .strict();

/** 创建职位准备建议 Agent 任务处理器。 */
export function createJobAdviceTaskHandler(
  input:
    | {
        readonly runner: AgentRunner;
        readonly matching: MatchingRepository;
        readonly profiles: CandidateProfileReader;
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
    leaseDurationMs: 300_000,
    concurrencyKey: (payload) => `match-advice:${payload.matchResultId}`,
    /** 执行应用适配器的该项操作。 */
    async execute(context, payload) {
      if ('unavailable' in input) {
        throw new TaskExecutionError('invalid_config', 'Job advice model is not configured.');
      }
      const match = input.matching.getMatch(parseId(payload.matchResultId, 'MatchResult'));
      if (!match) throw new TaskExecutionError('validation_failed', 'Match result does not exist.');
      // 1、恢复建议时确认评分仍绑定原职位与画像，拒绝跨输入复用。
      if (
        (payload.jobRevisionId !== undefined && match.jobRevisionId !== payload.jobRevisionId) ||
        (payload.profileVersionId !== undefined &&
          match.profileVersionId !== payload.profileVersionId)
      ) {
        throw new TaskExecutionError(
          'validation_failed',
          'Match advice checkpoint does not match task inputs.',
        );
      }
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
          ...(context.taskId ? { retryKey: context.taskId } : {}),
          definition: jobAdviceAgentDefinition,
          value: agentInput,
          signal: context.signal,
        });
        const output = parseJobAdviceAgentOutput(result.output);
        const stored = input.matching.saveAdvice({
          id: parseId(input.ids.generate(), 'MatchAdvice'),
          matchResultId: match.id,
          matchInputHash: match.inputHash,
          agentRunId: result.run.id,
          schemaVersion: jobAdviceAgentDefinition.outputSchemaVersion,
          contentHash: contentHash(output),
          result: output,
          createdAt: input.clock.now(),
        });
        return { matchAdviceId: stored.id, agentRunId: result.run.id, cacheHit: result.cacheHit };
      } catch (error) {
        if (error instanceof AgentRuntimeError) {
          if (error.category === 'invalid_output')
            throw new TaskExecutionError(
              'validation_failed',
              '建议生成失败：输出结构校验未通过（已纠正一次）。',
              { cause: error },
            );
          throw mapAgentRuntimeError(error, 'Job advice Agent');
        }
        throw error;
      }
    },
  };
}
