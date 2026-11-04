import { defineAgent, type AgentDefinition } from '@jobhunter/common/agent';
import { z } from 'zod';
import type { CandidateProfileData } from '@jobhunter/user/contracts';
import {
  jobUnderstandingSchema,
  jobUnderstandingAgentOutputSchema,
  type JobUnderstanding,
} from './job-understanding.js';
import { jobUnderstandingPromptV2 } from './prompts/job-understanding/v2.js';

const nullableText = z.string().trim().min(1).nullable();

/** 画像侧只传匹配判断所需的最小事实，避免把联系方式等无关内容交给模型。 */
export const profileSnapshotSchema = z
  .object({
    targetRoles: z.array(z.string().trim().min(1)),
    domains: z.array(z.string().trim().min(1)),
    yearsOfExperience: z.number().nonnegative().nullable(),
    skills: z.array(z.string().trim().min(1)),
    professionalSkills: nullableText,
  })
  .strict();

/** 模块使用的类型约束。 */
export type ProfileSnapshot = z.infer<typeof profileSnapshotSchema>;

/** 从候选人画像提取匹配判断所需的最小事实快照。 */
export function buildProfileSnapshot(profile: CandidateProfileData): ProfileSnapshot {
  return {
    targetRoles: [...profile.targetRoles],
    domains: [...profile.domains],
    yearsOfExperience: profile.yearsOfExperience,
    skills: profile.skills.map((skill) => skill.name),
    professionalSkills: profile.professionalSkills,
  };
}

/** 职位理解 Agent 输入 Schema。 */
export const jobUnderstandingInputSchema = z
  .object({
    title: z.string().trim().min(1),
    description: z.string().trim().min(1),
    experienceText: nullableText,
    educationText: nullableText,
    profile: profileSnapshotSchema,
  })
  .strict();

/** 模块使用的类型约束。 */
export type JobUnderstandingInput = z.infer<typeof jobUnderstandingInputSchema>;

/** 职位理解 Agent 定义。 */
export const jobUnderstandingAgentDefinition: AgentDefinition<
  JobUnderstandingInput,
  JobUnderstanding
> = defineAgent({
  key: jobUnderstandingPromptV2.agentKey,
  version: '2.0.0',
  promptVersion: jobUnderstandingPromptV2.promptVersion,
  outputSchemaVersion: jobUnderstandingPromptV2.outputSchemaVersion,
  outputSchemaName: 'JobUnderstandingOutput',
  systemPrompt: jobUnderstandingPromptV2.text,
  inputSchema: jobUnderstandingInputSchema,
  outputSchema: jobUnderstandingSchema,
  tools: [],
  limits: {
    // 证据引文密集的职位理解输出实测可达约 7k Token
    timeoutMs: 240_000,
    maxSteps: 2,
    maxInputTokens: 24_000,
    maxOutputTokens: 16_000,
    maxEstimatedCostMicros: 200_000,
  },
});

/** 执行模块的解析、转换或评分或调用辅助逻辑。 */
function allEvidence(
  value: unknown,
): readonly { field: keyof Omit<JobUnderstandingInput, 'profile'>; quote: string }[] {
  const evidence: { field: keyof Omit<JobUnderstandingInput, 'profile'>; quote: string }[] = [];
  const visit = (current: unknown): void => {
    if (Array.isArray(current)) {
      for (const item of current) visit(item);
      return;
    }
    if (typeof current !== 'object' || current === null) return;
    const record = current as Readonly<Record<string, unknown>>;
    if (typeof record.field === 'string' && typeof record.quote === 'string') {
      evidence.push({
        field: record.field as keyof Omit<JobUnderstandingInput, 'profile'>,
        quote: record.quote,
      });
    }
    for (const child of Object.values(record)) visit(child);
  };
  visit(value);
  return evidence;
}

/** 校验 Agent 输出并限制事实证据只能来自职位输入正文。 */
export function parseJobUnderstandingAgentOutput(
  output: unknown,
  input: JobUnderstandingInput,
): JobUnderstanding {
  const parsed = jobUnderstandingAgentOutputSchema.parse(output);
  for (const reference of allEvidence(parsed)) {
    const source = input[reference.field];
    if (!source?.includes(reference.quote)) {
      throw new TypeError(`Job understanding evidence is not present in ${reference.field}.`);
    }
  }
  return jobUnderstandingSchema.parse(parsed);
}
