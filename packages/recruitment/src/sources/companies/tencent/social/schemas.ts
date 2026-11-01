import { z } from 'zod';

/** 腾讯社会招聘接口配置 Schema。 */
export const tencentConfigSchema = z
  .object({
    language: z.literal('zh-cn').default('zh-cn'),
    pageSize: z.number().int().min(1).max(100).default(100),
  })
  .strict();

/** 来源适配器使用的类型约束。 */
export type TencentConfig = z.infer<typeof tencentConfigSchema>;

/** 来源输入或输出的运行时校验 Schema。 */
export const tencentListJobSchema = z
  .object({
    PostId: z.string().min(1),
    RecruitPostName: z.string().min(1),
    CountryName: z.string().nullable().optional(),
    LocationName: z.string().nullable().optional(),
    BGName: z.string().nullable().optional(),
    ComCode: z.string().nullable().optional(),
    ComName: z.string().nullable().optional(),
    ProductName: z.string().nullable().optional(),
    CategoryName: z.string().nullable().optional(),
    Responsibility: z.string().min(1),
    LastUpdateTime: z.string().nullable().optional(),
    PostURL: z.string().min(1),
    SourceID: z.number().int(),
    IsValid: z.boolean().optional(),
    RequireWorkYearsName: z.string().nullable().optional(),
  })
  .loose();

/** 来源适配器使用的类型约束。 */
export type TencentListJob = z.infer<typeof tencentListJobSchema>;

/** 来源输入或输出的运行时校验 Schema。 */
export const tencentListResponseSchema = z
  .object({
    Code: z.literal(200),
    Data: z
      .object({
        Count: z.number().int().nonnegative(),
        Posts: z.array(tencentListJobSchema),
      })
      .strict(),
  })
  .loose();

/** 来源输入或输出的运行时校验 Schema。 */
export const tencentDetailSchema = tencentListJobSchema.extend({
  Requirement: z.string().min(1),
  DepartmentIntroduction: z.string().nullable().optional(),
  OuterPostTypeID: z.string().nullable().optional(),
});

/** 来源适配器使用的类型约束。 */
export type TencentDetail = z.infer<typeof tencentDetailSchema>;

/** 来源输入或输出的运行时校验 Schema。 */
export const tencentDetailResponseSchema = z
  .object({ Code: z.literal(200), Data: tencentDetailSchema })
  .loose();
