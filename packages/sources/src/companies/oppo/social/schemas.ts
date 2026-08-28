import { z } from 'zod';

export const oppoSocialConfigSchema = z
  .object({
    pageSize: z.number().int().min(1).max(200).default(200),
    keyword: z.string().default(''),
  })
  .strict();
export type OppoSocialConfig = z.infer<typeof oppoSocialConfigSchema>;

export const oppoSocialJobSchema = z
  .object({
    positionId: z.string().min(1),
    publishName: z.string().min(1),
    jobCode: z.string().min(1),
    jobName: z.string().min(1),
    workCityName: z.string().min(1).nullable().optional(),
    jobType: z.string().min(1).nullable().optional(),
    minWorkYears: z.number().int().nonnegative().nullable().optional(),
    maxWorkYears: z.number().int().nonnegative().nullable().optional(),
    educationRequire: z.string().min(1).nullable().optional(),
    jobDuty: z.string().min(1),
    workRequire: z.string().min(1),
    publishDate: z.string().nullable().optional(),
    recruitTypeName: z.string().min(1).nullable().optional(),
  })
  .loose();
export type OppoSocialJob = z.infer<typeof oppoSocialJobSchema>;

export const oppoSocialListSchema = z
  .object({
    code: z.union([z.literal('0'), z.literal(0)]),
    data: z
      .object({
        list: z.array(oppoSocialJobSchema),
        total: z.coerce.number().int().nonnegative(),
        pageSize: z.number().int().positive(),
        pageNum: z.number().int().positive(),
        pages: z.number().int().nonnegative(),
      })
      .loose(),
  })
  .loose();
