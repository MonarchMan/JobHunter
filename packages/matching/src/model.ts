import type { CandidateProfileData, NormalizedJob } from '@jobhunter/domain';
import { z } from 'zod';
import type { JobUnderstanding } from './job-understanding.js';

/** 匹配规则或评分引用的证据片段。 */
export const matchingEvidenceSchema = z
  .object({
    source: z.enum(['profile', 'preference', 'job', 'enrichment', 'company']),
    path: z.string().trim().min(1),
    summary: z.string().trim().min(1).max(300),
  })
  .strict();

/** 单条资格规则评估结果。 */
export const ruleOutcomeSchema = z
  .object({
    ruleId: z.string().trim().min(1),
    status: z.enum(['pass', 'fail', 'unknown']),
    evidence: z.array(matchingEvidenceSchema),
    explanation: z.string().trim().min(1).max(500),
  })
  .strict();

/** 可解释评分维度。 */
export const scoreDimensionSchema = z.enum([
  'skills',
  'experience',
  'role',
  'industry',
  'location',
]);

/** 单个评分维度的分数和证据。 */
export const scoreComponentSchema = z
  .object({
    dimension: scoreDimensionSchema,
    score: z.number().min(0).max(100),
    maximumScore: z.number().min(0).max(100),
    matchedEvidence: z.array(matchingEvidenceSchema),
    missingEvidence: z.array(z.string()),
    uncertainties: z.array(z.string()),
  })
  .strict()
  .refine((value) => value.score <= value.maximumScore, 'Component score exceeds its maximum.');

/** 模块使用的类型约束。 */
export type RuleStatus = z.infer<typeof ruleOutcomeSchema>['status'];
/** 模块使用的类型约束。 */
export type MatchingEvidence = z.infer<typeof matchingEvidenceSchema>;
/** 模块使用的类型约束。 */
export type RuleOutcome = z.infer<typeof ruleOutcomeSchema>;
/** 模块使用的类型约束。 */
export type ScoreDimension = z.infer<typeof scoreDimensionSchema>;
/** 模块使用的类型约束。 */
export type ScoreComponent = z.infer<typeof scoreComponentSchema>;

/** 模块数据结构或契约。 */
export interface MatchingCompanyContext {
  readonly sizeCategory: 'large' | 'medium' | 'other' | null;
  readonly industry: string | null;
}

/** 模块数据结构或契约。 */
export interface DeterministicMatchInput {
  readonly profile: CandidateProfileData;
  readonly job: NormalizedJob;
  readonly company: MatchingCompanyContext;
  readonly understanding: JobUnderstanding | null;
}

/** 确定性匹配输出 Schema。 */
export const deterministicMatchOutputSchema = z
  .object({
    filterStatus: z.enum(['eligible', 'excluded', 'uncertain']),
    ruleOutcomes: z.array(ruleOutcomeSchema),
    components: z.array(scoreComponentSchema),
    totalScore: z.number().min(0).max(100),
  })
  .strict();

/** 模块使用的类型约束。 */
export type DeterministicMatchOutput = z.infer<typeof deterministicMatchOutputSchema>;

/** 校验并解析确定性匹配输出。 */
export function parseDeterministicMatchOutput(input: unknown): DeterministicMatchOutput {
  return deterministicMatchOutputSchema.parse(input);
}
