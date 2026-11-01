import { z } from 'zod';

/** 首页下一步行动卡片的联合结构。 */
export const webDashboardNextActionSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('create_profile'),
      message: z.string(),
      href: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal('enable_sources'),
      message: z.string(),
      href: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal('review_matches'),
      message: z.string(),
      count: z.number().int().positive(),
      topJob: z
        .object({
          id: z.uuid(),
          companyName: z.string(),
          title: z.string(),
          score: z.number().min(0).max(100),
        })
        .strict()
        .nullable(),
      href: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal('handle_failures'),
      message: z.string(),
      count: z.number().int().positive(),
      href: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal('all_good'),
      message: z.string(),
    })
    .strict(),
]);

/** 应用层使用的类型约束。 */
export type WebDashboardNextAction = z.infer<typeof webDashboardNextActionSchema>;

/** 首页高亮职位摘要 Schema。 */
export const webDashboardHighlightJobSchema = z
  .object({
    id: z.uuid(),
    companyName: z.string(),
    title: z.string(),
    locations: z.array(z.string()),
    score: z.number().min(0).max(100).nullable(),
    matchReasons: z.array(z.string()).max(3),
    publishedAt: z.iso.datetime().nullable(),
    updatedAt: z.iso.datetime(),
    isNew: z.boolean(),
  })
  .strict();

/** 应用层使用的类型约束。 */
export type WebDashboardHighlightJob = z.infer<typeof webDashboardHighlightJobSchema>;

/** 首页仪表盘聚合数据 Schema。 */
export const webDashboardSchema = z
  .object({
    hasProfile: z.boolean().default(false),
    activeJobs: z.number().int().nonnegative(),
    currentMatches: z.number().int().nonnegative(),
    sources: z.object({
      healthy: z.number().int().nonnegative(),
      total: z.number().int().nonnegative(),
    }),
    tasks: z.object({
      pending: z.number().int().nonnegative(),
      failed: z.number().int().nonnegative(),
    }),
    latestSync: z
      .object({ sourceName: z.string(), status: z.string(), finishedAt: z.iso.datetime() })
      .nullable(),
    nextAction: webDashboardNextActionSchema.nullable(),
    highlightJobs: z.array(webDashboardHighlightJobSchema).max(5),
  })
  .strict();

/** 应用层使用的类型约束。 */
export type WebDashboard = z.infer<typeof webDashboardSchema>;
