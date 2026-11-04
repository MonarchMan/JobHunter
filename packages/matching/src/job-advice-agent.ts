import { jobAdviceSchema, type JobAdvice } from './contracts/job-advice.js';
export * from './contracts/job-advice.js';
import { defineAgent, type AgentDefinition } from '@jobhunter/common/agent';
import { candidateProfileSchema, type CandidateProfileData } from '@jobhunter/user/contracts';
import { normalizedJobSchema, type NormalizedJob } from '@jobhunter/recruitment/contracts/domain';
import { z } from 'zod';
import { deterministicMatchOutputSchema, type DeterministicMatchOutput } from './model.js';
import { jobAdvicePromptV4 } from './prompts/job-advice/v4.js';

/** 职位建议 Agent 输入 Schema。 */
export const jobAdviceInputSchema: z.ZodObject<{
  profile: typeof candidateProfileSchema;
  job: typeof normalizedJobSchema;
  match: typeof deterministicMatchOutputSchema;
}> = z
  .object({
    profile: candidateProfileSchema,
    job: normalizedJobSchema,
    match: deterministicMatchOutputSchema,
  })
  .strict();

/** 模块使用的类型约束。 */
export interface JobAdviceInput {
  readonly profile: CandidateProfileData;
  readonly job: NormalizedJob;
  readonly match: DeterministicMatchOutput;
}

/** 模型输出与持久化建议共用无引用结构。 */
export const jobAdviceModelOutputSchema = jobAdviceSchema.extend({
  preparation: jobAdviceSchema.shape.preparation.max(5),
});

/** 校验用户可见建议的结构与内部标识边界；事实依据由提示词和人工评测约束。 */
export function parseJobAdviceAgentOutput(output: unknown): JobAdvice {
  return jobAdviceModelOutputSchema.parse(output);
}

/** 职位准备建议不再构造或保存引用目录。 */
export const jobAdviceAgentDefinition: AgentDefinition<JobAdviceInput, JobAdvice> = defineAgent({
  key: jobAdvicePromptV4.agentKey,
  version: '4.0.0',
  promptVersion: jobAdvicePromptV4.promptVersion,
  outputSchemaVersion: jobAdvicePromptV4.outputSchemaVersion,
  outputSchemaName: 'JobAdviceOutput',
  systemPrompt: jobAdvicePromptV4.text,
  inputSchema: jobAdviceInputSchema,
  outputSchema: jobAdviceModelOutputSchema,
  tools: [],
  limits: {
    timeoutMs: 240_000,
    maxSteps: 2,
    maxInputTokens: 32_000,
    maxOutputTokens: 16_000,
    maxEstimatedCostMicros: 200_000,
  },
});
