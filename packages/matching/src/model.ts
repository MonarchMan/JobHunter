import type { CandidateProfileData, NormalizedJob } from '@jobhunter/domain';
import { z } from 'zod';
import type { JobUnderstanding } from './job-understanding.js';

export const matchingEvidenceSchema = z
  .object({
    source: z.enum(['profile', 'preference', 'job', 'enrichment', 'company']),
    path: z.string().trim().min(1),
    summary: z.string().trim().min(1).max(300),
  })
  .strict();

export const ruleOutcomeSchema = z
  .object({
    ruleId: z.string().trim().min(1),
    status: z.enum(['pass', 'fail', 'unknown']),
    evidence: z.array(matchingEvidenceSchema),
    explanation: z.string().trim().min(1).max(500),
  })
  .strict();

export const scoreDimensionSchema = z.enum([
  'skills',
  'experience',
  'role',
  'industry',
  'location',
]);

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

export type RuleStatus = z.infer<typeof ruleOutcomeSchema>['status'];
export type MatchingEvidence = z.infer<typeof matchingEvidenceSchema>;
export type RuleOutcome = z.infer<typeof ruleOutcomeSchema>;
export type ScoreDimension = z.infer<typeof scoreDimensionSchema>;
export type ScoreComponent = z.infer<typeof scoreComponentSchema>;

export interface MatchingCompanyContext {
  readonly sizeCategory: 'large' | 'medium' | 'other' | null;
  readonly industry: string | null;
}

export interface DeterministicMatchInput {
  readonly profile: CandidateProfileData;
  readonly job: NormalizedJob;
  readonly company: MatchingCompanyContext;
  readonly understanding: JobUnderstanding | null;
}

export const deterministicMatchOutputSchema = z
  .object({
    filterStatus: z.enum(['eligible', 'excluded', 'uncertain']),
    ruleOutcomes: z.array(ruleOutcomeSchema),
    components: z.array(scoreComponentSchema),
    totalScore: z.number().min(0).max(100),
  })
  .strict();

export type DeterministicMatchOutput = z.infer<typeof deterministicMatchOutputSchema>;

export function parseDeterministicMatchOutput(input: unknown): DeterministicMatchOutput {
  return deterministicMatchOutputSchema.parse(input);
}
