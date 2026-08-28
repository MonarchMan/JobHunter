import { z } from 'zod';

export const huaweiSocialConfigSchema = z
  .object({
    pageSize: z.number().int().min(1).max(100).default(100),
    keyword: z.string().default(''),
  })
  .strict();
export type HuaweiSocialConfig = z.infer<typeof huaweiSocialConfigSchema>;

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
export type HuaweiSocialJob = z.infer<typeof huaweiSocialJobSchema>;

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
