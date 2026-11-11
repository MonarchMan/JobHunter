import type { ResumePolishSuggestionStore } from '../ports/resume-polish.js';
import { AgentRuntimeError, type AgentRunner } from '@jobhunter/common/agent';
import { parseId } from '@jobhunter/common/domain';
import {
  parseResumePolishAgentOutput,
  resumePolishAgentDefinition,
  resumePolishSectionSchema,
} from '@jobhunter/user/polish';
import { z } from 'zod';
import { mapAgentRuntimeError } from '@jobhunter/common/tasks';
import type { CandidateProfileRepository } from '../ports/profiles.js';
import { TaskExecutionError, type TaskHandler } from '@jobhunter/common/tasks';

/** 简历润色任务输入。 */
export const resumePolishTaskPayloadSchema = z
  .object({
    suggestionId: z.uuid(),
    profileId: z.uuid(),
    sourceVersionId: z.uuid(),
    sections: z.array(resumePolishSectionSchema).min(1).max(2),
  })
  .strict();

/** 简历润色任务输出。 */
export const resumePolishTaskOutputSchema = z
  .object({ suggestionId: z.uuid(), agentRunId: z.uuid(), cacheHit: z.boolean() })
  .strict();

/** 创建简历润色 Agent 任务处理器。 */
export function createResumePolishTaskHandler(
  // 1、校验简历版本；2、运行润色 Agent；3、校验建议证据；4、提交建议结果。
  input:
    | {
        readonly runner: AgentRunner;
        readonly suggestions: ResumePolishSuggestionStore;
        readonly profiles: CandidateProfileRepository;
      }
    | { readonly unavailable: true },
): TaskHandler<
  z.infer<typeof resumePolishTaskPayloadSchema>,
  z.infer<typeof resumePolishTaskOutputSchema>
> {
  return {
    taskType: 'resume.polish',
    payloadSchema: resumePolishTaskPayloadSchema,
    outputSchema: resumePolishTaskOutputSchema,
    defaultMaxAttempts: 3,
    leaseDurationMs: 180_000,
    concurrencyKey: (payload) => `resume-polish:${payload.profileId}`,
    /** 执行应用适配器的该项操作。 */
    async execute(context, payload) {
      if ('unavailable' in input) {
        throw new TaskExecutionError('invalid_config', 'Resume polish model is not configured.');
      }
      const version = input.profiles.getVersion(parseId(payload.sourceVersionId, 'ProfileVersion'));
      if (version?.profileId !== payload.profileId) {
        throw new TaskExecutionError('validation_failed', 'Resume profile version is unavailable.');
      }
      const targetRole = version.effective.targetRoles[0];
      if (!targetRole) {
        throw new TaskExecutionError('validation_failed', 'Resume target role is not confirmed.');
      }
      const selectedSections = [...new Set(payload.sections)];
      const agentInput = {
        targetRole,
        selectedSections,
        workExperience: selectedSections.includes('workExperience')
          ? version.effective.workExperience.map((item) => ({
              organization: item.organization,
              title: item.title,
              highlights: item.highlights,
            }))
          : null,
        projects: selectedSections.includes('projects')
          ? version.effective.projects.map((item) => ({
              name: item.name,
              role: item.role,
              highlights: item.highlights,
            }))
          : null,
      } as const;
      try {
        const request = {
          definition: resumePolishAgentDefinition,
          value: agentInput,
          signal: context.signal,
        };
        const result = await (context.taskId
          ? input.runner.runStep({
              ...request,
              execution: {
                taskId: context.taskId,
                stepKey: 'resume-polish',
                resourceKey: payload.suggestionId,
              },
            })
          : input.runner.run(request));
        const polished = parseResumePolishAgentOutput(result.output, agentInput);
        input.suggestions.save(payload.suggestionId, payload.sourceVersionId, polished);
        return {
          suggestionId: payload.suggestionId,
          agentRunId: result.run.id,
          cacheHit: result.cacheHit,
        };
      } catch (error) {
        if (error instanceof AgentRuntimeError) {
          throw mapAgentRuntimeError(error, '简历润色');
        }
        throw error;
      }
    },
  };
}
