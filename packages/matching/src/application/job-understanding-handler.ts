import { AgentRuntimeError, type AgentRunner } from '@jobhunter/common/agent';
import { contentHash, parseId, type Clock, type IdGenerator } from '@jobhunter/common/domain';
import {
  buildProfileSnapshot,
  jobUnderstandingAgentDefinition,
  parseJobUnderstandingAgentOutput,
} from '../job-understanding-agent.js';
import { z } from 'zod';
import { recruitmentCategory } from '../recruitment-requirements.js';
import { mapAgentRuntimeError } from '@jobhunter/common/tasks';
import type { MatchingRepository } from '../ports/matching.js';
import type { CandidateProfileReader } from '@jobhunter/user/contracts';
import { TaskExecutionError, type TaskHandler } from '@jobhunter/common/tasks';

/** 职位理解任务输入，绑定职位、修订版本和评分所用画像版本。 */
export const jobUnderstandingTaskPayloadSchema = z
  .object({
    jobRevisionId: z.string().trim().min(1),
    profileVersionId: z.string().trim().min(1),
  })
  .strict();

/** 职位理解任务输出摘要；模型不可用或重试用尽时降级为空，评分退回规则口径。 */
export const jobUnderstandingTaskOutputSchema = z
  .object({
    jobEnrichmentId: z.string().trim().min(1).nullable(),
    fitScore: z.number().min(0).max(100).nullable(),
    fitReasons: z.array(z.string().trim().min(1).max(300)).max(5),
    agentRunId: z.string().trim().min(1).nullable(),
    cacheHit: z.boolean(),
  })
  .strict();

/** 模块使用的类型约束。 */
type UnderstandingOutput = z.infer<typeof jobUnderstandingTaskOutputSchema>;

const defaultMaxAttempts = 3;

/** 创建职位理解 Agent 任务处理器。 */
export function createJobUnderstandingTaskHandler(
  input:
    | {
        readonly runner: AgentRunner;
        readonly matching: MatchingRepository;
        readonly profiles: CandidateProfileReader;
        readonly clock: Clock;
        readonly ids: IdGenerator;
        readonly onEnrichmentStored?: (
          enrichment: ReturnType<MatchingRepository['saveEnrichment']>,
        ) => void;
      }
    | { readonly unavailable: true },
): TaskHandler<z.infer<typeof jobUnderstandingTaskPayloadSchema>, UnderstandingOutput> {
  const degraded: UnderstandingOutput = {
    jobEnrichmentId: null,
    fitScore: null,
    fitReasons: [],
    agentRunId: null,
    cacheHit: false,
  };
  return {
    taskType: 'job.enrich',
    payloadSchema: jobUnderstandingTaskPayloadSchema,
    outputSchema: jobUnderstandingTaskOutputSchema,
    defaultMaxAttempts,
    leaseDurationMs: 300_000,
    concurrencyKey: (payload) => `job-enrich:${payload.jobRevisionId}`,
    /** 执行应用适配器的该项操作。 */
    async execute(context, payload): Promise<UnderstandingOutput> {
      // 1、模型未配置直接降级；失败先按任务机制重试，最后一次尝试仍失败也降级。
      if ('unavailable' in input) return degraded;
      const finalAttempt = context.attempt !== undefined && context.attempt >= defaultMaxAttempts;
      const revision = input.matching.getRevision(parseId(payload.jobRevisionId, 'JobRevision'));
      if (!revision) {
        throw new TaskExecutionError('validation_failed', 'Job revision does not exist.');
      }
      const profile = input.profiles.getVersion(
        parseId(payload.profileVersionId, 'ProfileVersion'),
      );
      if (!profile) {
        throw new TaskExecutionError('validation_failed', 'Profile version does not exist.');
      }
      const agentInput = {
        title: revision.normalized.title,
        description: revision.normalized.description,
        experienceText: revision.normalized.experienceText,
        educationText: revision.normalized.educationText,
        recruitmentCategory: recruitmentCategory(revision.normalized),
        locations: revision.normalized.locations,
        employmentType: revision.normalized.employmentType,
        company: input.matching.getCompanyContext(revision.normalized.companyId),
        profile: buildProfileSnapshot(profile.effective),
      };
      try {
        const result = await input.runner.run({
          ...(context.taskId ? { retryKey: context.taskId } : {}),
          definition: jobUnderstandingAgentDefinition,
          value: agentInput,
          signal: context.signal,
        });
        const understanding = parseJobUnderstandingAgentOutput(result.output, agentInput);
        // 2、拟合判断随画像变化，只随本次任务返回；按职位存储的事实剥离判断字段。
        const facts = {
          requiredSkills: understanding.requiredSkills,
          preferredSkills: understanding.preferredSkills,
          minimumYearsExperience: understanding.minimumYearsExperience,
          seniority: understanding.seniority,
          domains: understanding.domains,
        };
        const stored = input.matching.saveEnrichment({
          id: parseId(input.ids.generate(), 'JobEnrichment'),
          jobRevisionId: revision.id,
          agentRunId: result.run.id,
          schemaVersion: jobUnderstandingAgentDefinition.outputSchemaVersion,
          contentHash: contentHash(facts),
          result: facts,
          createdAt: input.clock.now(),
        });
        input.onEnrichmentStored?.(stored);
        return {
          jobEnrichmentId: stored.id,
          fitScore: understanding.fitScore ?? null,
          fitReasons: understanding.reasons ?? [],
          agentRunId: result.run.id,
          cacheHit: result.cacheHit,
        };
      } catch (error) {
        if (finalAttempt) return degraded;
        if (error instanceof AgentRuntimeError) {
          throw mapAgentRuntimeError(error, 'Job understanding Agent');
        }
        throw error;
      }
    },
  };
}
