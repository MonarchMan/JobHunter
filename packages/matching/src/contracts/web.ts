import { z } from 'zod';
import { jobAdviceSchema } from './job-advice.js';
import { ruleOutcomeSchema, scoreComponentSchema } from '../model.js';
import { webPaginationSchema } from '@jobhunter/common/web-contracts';

/** 职位列表查询参数 Schema。 */
export const webJobQuerySchema = z
  .object({
    sourceKind: z.enum(['official', 'platform']).default('official'),
    providerKey: z.enum(['boss', 'zhilian', '51job', 'liepin']).optional(),
    search: z.string().trim().min(1).max(200).optional(),
    companies: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
    statuses: z
      .array(z.enum(['active', 'stale', 'closed']))
      .max(3)
      .optional(),
    locations: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
    jobSubfamilies: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
    recruitmentCategory: z.enum(['all', 'internship', 'campus', 'social']).optional(),
    minimumScore: z.number().min(0).max(100).optional(),
    profileVersionId: z.uuid().optional(),
    sort: z.enum(['updated_desc', 'published_desc', 'score_desc']).default('published_desc'),
    page: z.number().int().positive().default(1),
    pageSize: z.number().int().min(1).max(100).default(25),
    cursor: z.string().max(1_000).optional(),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict()
  .transform((query) => ({
    ...query,
    // 1、平台默认包含未知类别；官网保留原有实习默认值。
    recruitmentCategory:
      query.recruitmentCategory ??
      (query.sourceKind === 'platform' ? ('all' as const) : ('internship' as const)),
  }));

/** 应用层使用的类型约束。 */
export type WebJobQuery = z.infer<typeof webJobQuerySchema>;

/** 单个职位匹配请求参数 Schema。 */
export const webJobMatchMutationSchema = z
  .object({
    profileVersionId: z.uuid().optional(),
    idempotencyToken: z.string().trim().min(8).max(200),
    mode: z.enum(['rules', 'llm']).default('rules'),
  })
  .strict();

/** 应用层使用的类型约束。 */
export type WebJobMatchMutation = z.infer<typeof webJobMatchMutationSchema>;

/** 批量职位匹配请求参数 Schema。 */
export const webJobBulkMatchMutationSchema = webJobMatchMutationSchema
  .extend({ jobIds: z.array(z.uuid()).min(1).max(100) })
  .strict();

/** 职位列表行数据 Schema。 */
export const webJobListItemSchema = z
  .object({
    id: z.uuid(),
    companyId: z.uuid(),
    companyName: z.string(),
    title: z.string(),
    department: z.string().nullable(),
    jobFamily: z.string().nullable(),
    jobSubfamily: z.string().nullable(),
    recruitmentCategory: z.enum(['internship', 'campus', 'social']).nullable(),
    locations: z.array(z.string()),
    status: z.enum(['active', 'stale', 'closed']),
    detailUrl: z.url({ protocol: /^https$/ }),
    applyUrl: z.url({ protocol: /^https$/ }),
    publishedAt: z.iso.datetime().nullable(),
    updatedAt: z.iso.datetime(),
    score: z.number().min(0).max(100).nullable(),
  })
  .strict();

/** 应用层使用的类型约束。 */
export type WebJobListItem = z.infer<typeof webJobListItemSchema>;

/** 职位分页结果 Schema。 */
export const webJobPageSchema = z
  .object({
    items: z.array(webJobListItemSchema),
    page: webPaginationSchema,
    hasPreviousPage: z.boolean(),
    hasNextPage: z.boolean(),
    nextCursor: z.string().nullable(),
  })
  .strict();

/** 应用层使用的类型约束。 */
export type WebJobPage = z.infer<typeof webJobPageSchema>;

/** 职位修订记录 Schema。 */
/** 职位历史修订记录 Schema。 */
export const webJobRevisionSchema = z
  .object({
    id: z.uuid(),
    revisionNumber: z.number().int().positive(),
    changes: z.record(z.string(), z.unknown()),
    createdAt: z.iso.datetime(),
  })
  .strict();

/** 职位匹配结果及建议状态 Schema。 */
/** 职位匹配结果及建议状态 Schema。 */
export const webJobMatchSchema = z
  .object({
    id: z.uuid(),
    profileVersionId: z.uuid(),
    filterStatus: z.enum(['eligible', 'excluded', 'uncertain']),
    totalScore: z.number().min(0).max(100),
    components: z.array(scoreComponentSchema),
    ruleOutcomes: z.array(ruleOutcomeSchema),
    createdAt: z.iso.datetime(),
    advice: z.discriminatedUnion('status', [
      z.object({ status: z.literal('available'), content: jobAdviceSchema }).strict(),
      z.object({ status: z.enum(['not_requested', 'pending', 'failed']) }).strict(),
    ]),
  })
  .strict();

/** 职位详情及历史修订、匹配结果 Schema。 */
export const webJobDetailSchema = webJobListItemSchema
  .extend({
    sourceId: z.uuid(),
    externalJobId: z.string(),
    employmentType: z.string().nullable(),
    recruitmentCategory: z.enum(['internship', 'campus', 'social']).nullable(),
    experienceText: z.string().nullable(),
    educationText: z.string().nullable(),
    description: z.string(),
    firstSeenAt: z.iso.datetime(),
    lastSeenAt: z.iso.datetime(),
    closedAt: z.iso.datetime().nullable(),
    revisions: z.array(webJobRevisionSchema),
    matches: z.array(webJobMatchSchema),
  })
  .strict();

/** 应用层使用的类型约束。 */
export type WebJobDetail = z.infer<typeof webJobDetailSchema>;
