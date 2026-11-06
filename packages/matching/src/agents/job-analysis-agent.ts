import { AgentRuntimeError, defineAgent, type AgentDefinition } from '@jobhunter/common/agent';
import { z } from 'zod';
import { candidateProfileSchema, type CandidateProfileData } from '@jobhunter/user/contracts';
import { jobUnderstandingSchema } from './job-understanding.js';
import { jobAdviceSchema } from '../contracts/job-advice.js';
import { jobAnalysisPrompt } from '../prompts/job-analysis.js';

const nullableText = z.string().trim().min(1).nullable();

/** 画像侧只传匹配判断所需的最小事实，避免把联系方式等无关内容交给模型。 */
export const profileSnapshotSchema = z
  .object({
    targetRoles: z.array(z.string().trim().min(1)),
    domains: z.array(z.string().trim().min(1)),
    yearsOfExperience: z.number().nonnegative().nullable(),
    skills: candidateProfileSchema.unwrap().shape.skills,
    professionalSkills: nullableText,
    education: candidateProfileSchema.unwrap().shape.education.optional(),
    preferences: candidateProfileSchema.unwrap().shape.preferences.optional(),
    matchingConstraints: candidateProfileSchema.unwrap().shape.matchingConstraints,
    ...candidateProfileSchema.unwrap().pick({
      workExperience: true,
      projects: true,
      works: true,
      competitions: true,
      certificates: true,
      languages: true,
    }).shape,
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
    skills: profile.skills,
    professionalSkills: profile.professionalSkills,
    education: profile.education,
    preferences: profile.preferences,
    ...(profile.matchingConstraints ? { matchingConstraints: profile.matchingConstraints } : {}),
    workExperience: profile.workExperience,
    projects: profile.projects.map(({ id, local_path, ...facts }) => {
      void id;
      void local_path;
      return facts;
    }),
    works: profile.works,
    competitions: profile.competitions,
    certificates: profile.certificates,
    languages: profile.languages,
  };
}

/** 职位理解 Agent 输入 Schema。 */
export const jobAnalysisFactsInputSchema = z
  .object({
    title: z.string().trim().min(1),
    description: z.string().trim().min(1),
    experienceText: nullableText,
    educationText: nullableText,
    recruitmentCategory: z.enum(['social', 'campus', 'internship', 'unknown']),
    locations: z.array(z.string()).optional(),
    employmentType: nullableText.optional(),
    company: z
      .object({
        sizeCategory: z.enum(['large', 'medium', 'other']).nullable(),
        industry: nullableText,
      })
      .strict()
      .optional(),
    profile: profileSnapshotSchema,
  })
  .strict();

/** 模块使用的类型约束。 */
export type JobAnalysisFactsInput = z.infer<typeof jobAnalysisFactsInputSchema>;

/** 执行模块的解析、转换或评分或调用辅助逻辑。 */
function allEvidence(
  value: unknown,
): readonly { field: keyof Omit<JobAnalysisFactsInput, 'profile'>; quote: string }[] {
  const evidence: { field: keyof Omit<JobAnalysisFactsInput, 'profile'>; quote: string }[] = [];
  const visit = (current: unknown): void => {
    if (Array.isArray(current)) {
      for (const item of current) visit(item);
      return;
    }
    if (typeof current !== 'object' || current === null) return;
    const record = current as Readonly<Record<string, unknown>>;
    if (typeof record.field === 'string' && typeof record.quote === 'string') {
      evidence.push({
        field: record.field as keyof Omit<JobAnalysisFactsInput, 'profile'>,
        quote: record.quote,
      });
    }
    for (const child of Object.values(record)) visit(child);
  };
  visit(value);
  return evidence;
}

/** 每个输出块有明确开关；关闭的块不要求模型生成内容。 */
export const jobAnalysisOutputSchema = z
  .object({
    understanding: jobUnderstandingSchema.omit({ fitScore: true, reasons: true }).nullable(),
    match: z
      .object({
        score: z.number().int().min(0).max(100),
        reasons: z.array(z.string().trim().min(1).max(300)).min(1).max(5),
      })
      .strict()
      .nullable(),
    advice: jobAdviceSchema
      .extend({ preparation: jobAdviceSchema.shape.preparation.max(5) })
      .nullable(),
  })
  .strict();
/** 单一 Agent 的开关和指令均参与输入身份，避免错误复用。 */
const analysisInputSchema = jobAnalysisFactsInputSchema.extend({
  outputs: z
    .object({ understanding: z.boolean(), match: z.boolean(), advice: z.boolean() })
    .strict(),
  instructions: z.string(),
});
export const jobAnalysisAgentDefinition: AgentDefinition<
  z.infer<typeof analysisInputSchema>,
  z.infer<typeof jobAnalysisOutputSchema>
> = defineAgent({
  key: 'job-analysis',
  outputSchemaVersion: '1.0.0',
  outputSchemaName: 'JobAnalysisOutput',
  systemPrompt: jobAnalysisPrompt,
  inputSchema: analysisInputSchema,
  outputSchema: jobAnalysisOutputSchema,
  validateOutput: (output, input) => {
    parseJobAnalysisOutput(output, input);
  },
  tools: [],
  resultPolicy: { cache: 'disabled', persistOutput: true },
  limits: {
    timeoutMs: 240_000,
    maxSteps: 2,
    maxInputTokens: 32_000,
    maxOutputTokens: 20_000,
    maxEstimatedCostMicros: 400_000,
  },
});
/** 校验启用块完整、关闭块为空，并检查事实证据来自职位原文。 */
export function parseJobAnalysisOutput(
  output: unknown,
  input: z.infer<typeof analysisInputSchema>,
): z.infer<typeof jobAnalysisOutputSchema> {
  const result = jobAnalysisOutputSchema.parse(output);
  for (const key of ['understanding', 'match', 'advice'] as const) {
    if (input.outputs[key] !== (result[key] !== null))
      throw new AgentRuntimeError(
        'invalid_output',
        'Job analysis output does not match enabled sections: ' + key,
      );
  }
  if (result.understanding) {
    for (const ref of allEvidence(result.understanding)) {
      const source = input[ref.field];
      if (typeof source !== 'string' || !source.includes(ref.quote))
        throw new AgentRuntimeError(
          'invalid_output',
          'Job analysis evidence is not present in ' + ref.field,
        );
    }
  }
  return result;
}
