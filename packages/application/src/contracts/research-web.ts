import { experienceResearchBriefSchema } from '@jobhunter/domain';
import { z } from 'zod';

export const webCreateExperienceResearchSchema = experienceResearchBriefSchema;

export const webExecuteExperienceResearchSchema = z
  .object({
    executorKey: z.literal('codex-local'),
    idempotencyToken: z.string().trim().min(8).max(200),
  })
  .strict();

export const webImportExperienceResearchBundleSchema = z
  .object({
    expectedRevision: z
      .string()
      .trim()
      .regex(/^\d+$/)
      .transform((value) => Number(value))
      .pipe(z.number().int().nonnegative()),
  })
  .strict();

export const webReviewExperienceResearchSchema = z
  .object({
    experienceId: z.uuid(),
    expectedRevision: z.number().int().nonnegative(),
    decision: z.enum(['accept', 'reject']),
  })
  .strict();

const communityExperienceFacetSchema = z.string().trim().min(1).max(200).optional();

export const webCommunityExperienceFilterSchema = z
  .object({
    company: communityExperienceFacetSchema,
    role: communityExperienceFacetSchema,
    stage: communityExperienceFacetSchema,
  })
  .strict()
  .transform((filter) => ({
    ...(filter.company === undefined ? {} : { company: filter.company }),
    ...(filter.role === undefined ? {} : { role: filter.role }),
    ...(filter.stage === undefined ? {} : { stage: filter.stage }),
  }));

export type {
  CommunityExperienceSummary,
  CommunityExperienceFilter,
  CommunityInterviewExperienceRecord,
  CommunityInterviewQuestionRecord,
  ExperienceResearchDetail,
  ExperienceResearchRequestRecord,
  ExperienceResearchRequestSummary,
  ExperienceResearchTaskSnapshot,
  ResearchRequestState,
} from '../ports/interview-research.js';
