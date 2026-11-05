import { z } from 'zod';
import { candidatePreferencesSchema, candidateProfileSchema } from '../domain/index.js';
import { resumePolishAgentOutputSchema, resumePolishSectionSchema } from './resume-polish.js';
import { webTaskAcceptedSchema } from '@jobhunter/common/web-contracts';

/** 简历导入响应。 */
export const webResumeImportResultSchema = z
  .object({
    document: z
      .object({
        id: z.uuid(),
        mediaType: z.string().min(1),
        parseStatus: z.enum(['parsed', 'needs_ocr', 'failed']),
        parserVersion: z.string().nullable(),
        errorSummary: z.string().nullable(),
        createdAt: z.number().int().nonnegative(),
      })
      .strict(),
    deduplicated: z.boolean(),
    profileId: z.uuid(),
    task: webTaskAcceptedSchema.nullable(),
  })
  .strict();

/** 应用层使用的类型约束。 */
export type WebResumeImportResult = z.infer<typeof webResumeImportResultSchema>;

/** 候选人画像摘要 Schema。 */
/** 候选人画像摘要 Schema。 */
export const webProfileSummarySchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    currentVersionId: z.uuid().nullable(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

/** 候选人画像版本 Schema。 */
/** 候选人画像版本 Schema。 */
export const webProfileVersionSchema = z
  .object({
    id: z.uuid(),
    profileId: z.uuid(),
    versionNumber: z.number().int().positive(),
    resumeDocumentId: z.uuid().nullable(),
    effective: candidateProfileSchema,
    isCandidate: z.boolean(),
    baseVersionId: z.uuid().nullable(),
    createdAt: z.iso.datetime(),
    extractionAgent: z
      .object({
        key: z.string(),
        definitionHash: z.string(),
        modelConfigHash: z.string(),
      })
      .strict()
      .nullable(),
  })
  .strict();

/** 候选人画像详情及版本列表 Schema。 */
export const webProfileDetailSchema = z
  .object({
    profile: webProfileSummarySchema,
    current: webProfileVersionSchema,
    versions: z.array(webProfileVersionSchema),
  })
  .strict();

/** 应用层使用的类型约束。 */
export type WebProfileDetail = z.infer<typeof webProfileDetailSchema>;

/** 候选人画像编辑操作 Schema。 */
export const webProfileMutationSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('replace'),
      profileId: z.uuid(),
      expectedVersionId: z.uuid(),
      profile: candidateProfileSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('set'),
      profileId: z.uuid(),
      expectedVersionId: z.uuid(),
      pointer: z.string().startsWith('/').max(500),
      value: z.unknown(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('confirm-extraction'),
      profileId: z.uuid(),
      expectedVersionId: z.uuid(),
      candidateVersionId: z.uuid(),
      fields: z.array(candidateProfileSchema.unwrap().keyof()).min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal('preferences'),
      profileId: z.uuid(),
      expectedVersionId: z.uuid(),
      preferences: candidatePreferencesSchema,
    })
    .strict(),
]);

/** 应用层使用的类型约束。 */
export type WebProfileMutation = z.infer<typeof webProfileMutationSchema>;

/** 简历润色请求 Schema。 */
/** 简历润色请求 Schema。 */
export const webResumePolishRequestSchema = z
  .object({
    profileId: z.uuid(),
    sourceVersionId: z.uuid(),
    sections: z.array(resumePolishSectionSchema).min(1).max(2),
    idempotencyToken: z.string().trim().min(8).max(200),
  })
  .strict();

/** 简历润色任务受理响应 Schema。 */
export const webResumePolishAcceptedSchema = z
  .object({
    suggestionId: z.uuid(),
    task: z
      .object({
        taskId: z.uuid(),
        status: z.enum(['pending', 'running', 'succeeded', 'failed', 'cancelled']),
        deduplicated: z.boolean(),
        statusUrl: z.string().startsWith('/api/profile/polish'),
      })
      .strict(),
  })
  .strict();

/** 应用层使用的类型约束。 */
export type WebResumePolishAccepted = z.infer<typeof webResumePolishAcceptedSchema>;

/** 简历润色任务状态响应 Schema。 */
export const webResumePolishStatusSchema = z
  .object({
    suggestionId: z.uuid(),
    status: z.enum(['pending', 'running', 'succeeded', 'failed', 'cancelled']),
    errorSummary: z.string().nullable(),
    suggestion: z
      .object({
        sourceVersionId: z.uuid(),
        sections: z.array(resumePolishSectionSchema).min(1).max(2),
        result: resumePolishAgentOutputSchema,
      })
      .strict()
      .nullable(),
  })
  .strict();

/** 应用层使用的类型约束。 */
/** 简历润色任务状态响应类型。 */
export type WebResumePolishStatus = z.infer<typeof webResumePolishStatusSchema>;

/** 简历删除影响预览 Schema。 */
export const webResumeDeletionImpactSchema = z
  .object({
    resumeDocumentId: z.uuid(),
    impactHash: z.string().length(64),
    counts: z
      .object({
        profiles: z.number().int().nonnegative(),
        profileVersions: z.number().int().nonnegative(),
        resumeDocuments: z.number().int().nonnegative(),
        matchResults: z.number().int().nonnegative(),
        agentRuns: z.number().int().nonnegative(),
        artifacts: z.number().int().nonnegative(),
        resumeDrafts: z.number().int().nonnegative(),
        resumeExports: z.number().int().nonnegative(),
      })
      .strict(),
    warnings: z.array(z.string()),
  })
  .strict();

/** 应用层使用的类型约束。 */
export type WebResumeDeletionImpact = z.infer<typeof webResumeDeletionImpactSchema>;

/** 简历删除确认请求 Schema。 */
export const webResumeDeletionConfirmSchema = z
  .object({
    resumeDocumentId: z.uuid(),
    expectedImpactHash: z.string().length(64),
    confirmation: z.literal('DELETE'),
    idempotencyToken: z.string().trim().min(8).max(200),
  })
  .strict();

/** 应用层使用的类型约束。 */
export type WebResumeDeletionConfirm = z.infer<typeof webResumeDeletionConfirmSchema>;
