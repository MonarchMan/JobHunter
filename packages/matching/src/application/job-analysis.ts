import { type AgentRunner, AgentRuntimeError } from '@jobhunter/common/agent';
import { contentHash, parseId, type Clock, type IdGenerator } from '@jobhunter/common/domain';
import {
  TaskExecutionError,
  mapAgentRuntimeError,
  type TaskHandlerContext,
} from '@jobhunter/common/tasks';
import type { MatchingRepository } from '../ports/matching.js';
import type { CandidateProfileReader } from '@jobhunter/user/contracts';
import {
  buildProfileSnapshot,
  jobAnalysisAgentDefinition,
  parseJobAnalysisOutput,
} from '../agents/job-analysis-agent.js';
import { recruitmentCategory } from '../scoring/recruitment-requirements.js';
import type { JobAdvice } from '../contracts/job-advice.js';

/** 分析结果仅在本次评分流程传递；建议与评分保存时绑定同一次模型运行。 */
export interface JobAnalysisResult {
  readonly inputIdentity: { readonly jobRevisionId: string; readonly profileVersionId: string };
  readonly jobEnrichmentId: string | null;
  readonly fitScore: number | null;
  readonly fitReasons: readonly string[];
  readonly advice: JobAdvice | null;
  readonly agentRunId: string | null;
}
/** 统一分析用例端口，模型调用和建议保存均由评分流程装配。 */
export interface JobAnalysis {
  analyze(
    context: TaskHandlerContext,
    payload: { jobRevisionId: string; profileVersionId: string; score: boolean; advice: boolean },
  ): Promise<JobAnalysisResult>;
  storeAdvice(matchResultId: string, analysis: JobAnalysisResult): string | null;
}
/** 评分内部分析用例，不注册独立任务。 */
export function createJobAnalysis(
  input:
    | {
        runner: AgentRunner;
        matching: MatchingRepository;
        profiles: CandidateProfileReader;
        clock: Clock;
        ids: IdGenerator;
      }
    | { unavailable: true },
): JobAnalysis {
  return {
    async analyze(
      context: TaskHandlerContext,
      payload: { jobRevisionId: string; profileVersionId: string; score: boolean; advice: boolean },
    ): Promise<JobAnalysisResult> {
      const empty: JobAnalysisResult = {
        inputIdentity: {
          jobRevisionId: payload.jobRevisionId,
          profileVersionId: payload.profileVersionId,
        },
        jobEnrichmentId: null,
        fitScore: null,
        fitReasons: [],
        advice: null,
        agentRunId: null,
      };
      if (!payload.score && !payload.advice) return empty;
      if ('unavailable' in input) {
        if (payload.advice)
          throw new TaskExecutionError('invalid_config', '职位分析模型尚未配置。');
        return empty;
      }
      const job = input.matching.getRevision(parseId(payload.jobRevisionId, 'JobRevision'));
      const profile = input.profiles.getVersion(
        parseId(payload.profileVersionId, 'ProfileVersion'),
      );
      if (!job || !profile || profile.isCandidate)
        throw new TaskExecutionError('validation_failed', '职位或画像已失效。');
      const value = {
        title: job.normalized.title,
        description: job.normalized.description,
        experienceText: job.normalized.experienceText,
        educationText: job.normalized.educationText,
        recruitmentCategory: recruitmentCategory(job.normalized),
        locations: job.normalized.locations,
        employmentType: job.normalized.employmentType,
        company: input.matching.getCompanyContext(job.normalized.companyId),
        profile: buildProfileSnapshot(profile.effective),
        outputs: { understanding: payload.score, match: payload.score, advice: payload.advice },
        instructions: [
          payload.score
            ? '提取职位事实并综合所有相关维度给出匹配分数及理由。'
            : '不生成职位事实或模型评分，understanding 和 match 均返回 null。',
          payload.advice
            ? '生成有依据的亮点、缺口和准备行动，存入 advice。'
            : '不生成求职建议，advice 返回 null。',
        ].join('\n'),
      };
      try {
        const result = await input.runner.run({
          definition: jobAnalysisAgentDefinition,
          value,
          signal: context.signal,
          ...(context.taskId ? { retryKey: context.taskId } : {}),
        });
        context.signal.throwIfAborted();
        const parsed = parseJobAnalysisOutput(result.output, value);
        let jobEnrichmentId: string | null = null;
        if (parsed.understanding) {
          const facts = parsed.understanding;
          jobEnrichmentId = input.matching.saveEnrichment({
            id: parseId(input.ids.generate(), 'JobEnrichment'),
            jobRevisionId: job.id,
            agentRunId: result.run.id,
            schemaVersion: jobAnalysisAgentDefinition.outputSchemaVersion,
            contentHash: contentHash(facts),
            result: facts,
            createdAt: input.clock.now(),
          }).id;
        }
        return {
          inputIdentity: {
            jobRevisionId: payload.jobRevisionId,
            profileVersionId: payload.profileVersionId,
          },
          jobEnrichmentId,
          fitScore: parsed.match?.score ?? null,
          fitReasons: parsed.match?.reasons ?? [],
          advice: parsed.advice,
          agentRunId: result.run.id,
        };
      } catch (error) {
        // 仅评分模式在最后一次失败后允许退回规则；请求了建议时完整保留失败语义。
        context.signal.throwIfAborted();
        if (
          error instanceof AgentRuntimeError &&
          error.category !== 'cancelled' &&
          !payload.advice &&
          context.attempt !== undefined &&
          context.attempt >= 3
        )
          return empty;
        if (error instanceof AgentRuntimeError) throw mapAgentRuntimeError(error, '职位分析');
        throw error;
      }
    },
    storeAdvice(matchResultId: string, analysis: JobAnalysisResult): string | null {
      if (!analysis.advice || !analysis.agentRunId || 'unavailable' in input) return null;
      const match = input.matching.getMatch(parseId(matchResultId, 'MatchResult'));
      if (!match) throw new TaskExecutionError('validation_failed', '评分结果不存在。');
      // 其他画像可覆盖同一职位的当前评分，禁止将迟到建议绑定到新输入。
      if (
        match.jobRevisionId !== analysis.inputIdentity.jobRevisionId ||
        match.profileVersionId !== analysis.inputIdentity.profileVersionId
      )
        throw new TaskExecutionError('cancelled', '评分输入已变化，请重新分析职位。');
      return input.matching.saveAdvice({
        id: parseId(input.ids.generate(), 'MatchAdvice'),
        matchResultId: match.id,
        matchInputHash: match.inputHash,
        agentRunId: parseId(analysis.agentRunId, 'AgentRun'),
        schemaVersion: jobAnalysisAgentDefinition.outputSchemaVersion,
        contentHash: contentHash(analysis.advice),
        result: analysis.advice,
        createdAt: input.clock.now(),
      }).id;
    },
  };
}
