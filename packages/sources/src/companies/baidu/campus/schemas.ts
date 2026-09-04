import { z } from 'zod';

/** 百度招聘类别枚举。 */
export const baiduRecruitTypeSchema = z.enum(['INTERN', 'GRADUATE', 'SOCIAL']);
export type BaiduRecruitType = z.infer<typeof baiduRecruitTypeSchema>;

export const baiduConfigSchema = z
  .object({
    pageSize: z.number().int().min(1).max(20).default(20),
    keyword: z.string().default(''),
    recruitTypes: z
      .array(baiduRecruitTypeSchema)
      .min(1)
      .default(['INTERN', 'GRADUATE'])
      .refine((values) => new Set(values).size === values.length, 'Recruit types must be unique.'),
  })
  .strict();

/** 来源适配器使用的类型约束。 */
export type BaiduConfig = z.infer<typeof baiduConfigSchema>;

/** 来源输入或输出的运行时校验 Schema。 */
export const baiduJobSchema = z
  .object({
    postId: z.string().min(1),
    jobId: z.string().min(1),
    name: z.string().min(1),
    orgName: z.string().nullable().optional(),
    postType: z.string().nullable().optional(),
    publishDate: z.string().nullable().optional(),
    updateDate: z.string().nullable().optional(),
    recruitNum: z.string().nullable().optional(),
    serviceCondition: z.string().nullable().optional(),
    workContent: z.string().nullable().optional(),
    workPlace: z.string().nullable().optional(),
    workYears: z.string().nullable().optional(),
    education: z.string().nullable().optional(),
    projectType: z.string().nullable().optional(),
    projectTypeCode: z.string().nullable().optional(),
    bgShortName: z.string().nullable().optional(),
    hotFlag: z.boolean().optional(),
  })
  .loose();

/** 来源适配器使用的类型约束。 */
export type BaiduJob = z.infer<typeof baiduJobSchema>;

/** 来源输入或输出的运行时校验 Schema。 */
export const baiduDiscoveredJobSchema = baiduJobSchema.extend({
  recruitType: baiduRecruitTypeSchema,
});

/** 来源适配器使用的类型约束。 */
export type BaiduDiscoveredJob = z.infer<typeof baiduDiscoveredJobSchema>;

/** 来源输入或输出的运行时校验 Schema。 */
export const baiduListResponseSchema = z
  .object({
    status: z.literal('ok'),
    message: z.string().nullable().optional(),
    data: z
      .object({
        pageNum: z.coerce.number().int().positive(),
        pageSize: z.coerce.number().int().positive(),
        total: z.coerce.number().int().nonnegative(),
        list: z.array(baiduJobSchema),
      })
      .loose(),
  })
  .loose();

/** 来源适配器使用的类型约束。 */
export type BaiduListResponse = z.infer<typeof baiduListResponseSchema>;
