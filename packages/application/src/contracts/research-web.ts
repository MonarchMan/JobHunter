import { experienceResearchBriefSchema } from '@jobhunter/domain';
import { z } from 'zod';

/** 创建网友面经研究请求。 */
export const webCreateExperienceResearchSchema = experienceResearchBriefSchema;

/** 执行网友面经研究请求。 */
export const webExecuteExperienceResearchSchema = z
  .object({
    executorKey: z.enum(['codex-local', 'browser-assisted-codex']),
    idempotencyToken: z.string().trim().min(8).max(200),
  })
  .strict();

/** 导入外部研究结果包请求。 */
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

/** 审核网友面经候选请求。 */
export const webReviewExperienceResearchSchema = z
  .object({
    experienceId: z.uuid(),
    expectedRevision: z.number().int().nonnegative(),
    decision: z.enum(['accept', 'reject']),
  })
  .strict();

/** 网友面经列表的通用筛选字段。 */
const communityExperienceFacetSchema = z.string().trim().min(1).max(200).optional();

/** 网友面经历史筛选请求。 */
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

/** 应用层使用的类型约束。 */
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
