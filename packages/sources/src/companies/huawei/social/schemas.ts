import { z } from 'zod';

/** 华为社会招聘接口配置 Schema。 */
export const huaweiSocialConfigSchema = z
  .object({
    pageSize: z.number().int().min(1).max(100).default(100),
    keyword: z.string().default(''),
  })
  .strict();
/** 来源适配器使用的类型约束。 */
export type HuaweiSocialConfig = z.infer<typeof huaweiSocialConfigSchema>;

/** 来源输入或输出的运行时校验 Schema。 */
export const huaweiSocialJobSchema = z
  .object({
    jobId: z.number().int().positive(),
    dataSource: z.number().int().nonnegative(),
    jobname: z.string().min(1),
    jobAddress: z.string().nullable().optional(),
    mainBusiness: z.string().min(1),
    jobRequire: z.string().min(1),
    jobFamilyName: z.string().nullable().optional(),
    deptName: z.string().nullable().optional(),
    lastUpdateDate: z.string().nullable().optional(),
    workYear: z.number().int().nonnegative().nullable().optional(),
    degree: z.string().nullable().optional(),
  })
  .loose();
/** 来源适配器使用的类型约束。 */
export type HuaweiSocialJob = z.infer<typeof huaweiSocialJobSchema>;

/** 来源输入或输出的运行时校验 Schema。 */
export const huaweiSocialListSchema = z
  .object({
    pageVO: z
      .object({
        totalRows: z.number().int().nonnegative(),
        curPage: z.number().int().positive(),
        pageSize: z.number().int().positive(),
        totalPages: z.number().int().nonnegative(),
      })
      .loose(),
    result: z.array(huaweiSocialJobSchema),
  })
  .loose();
