import { z } from 'zod';

export const neteaseConfigSchema = z
  .object({
    pageSize: z.number().int().min(1).max(100).default(100),
    keyword: z.string().default(''),
  })
  .strict();
export type NeteaseConfig = z.infer<typeof neteaseConfigSchema>;

export const neteaseJobSchema = z
  .object({
    id: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]),
    name: z.string().min(1),
    workType: z.string().nullable().optional(),
    firstPostTypeName: z.string().nullable().optional(),
    requirement: z.string().min(1),
    description: z.string().min(1),
    reqEducationName: z.string().nullable().optional(),
    reqWorkYearsName: z.string().nullable().optional(),
    firstDepName: z.string().nullable().optional(),
    updateTime: z.number().int().nonnegative().nullable().optional(),
    productName: z.string().nullable().optional(),
    workPlaceNameList: z.array(z.string()).default([]),
    beeUrl: z.string().nullable().optional(),
  })
  .loose();
export type NeteaseJob = z.infer<typeof neteaseJobSchema>;

export const neteaseListSchema = z
  .object({
    code: z.literal(200),
    data: z
      .object({
        pages: z.number().int().nonnegative(),
        total: z.number().int().nonnegative(),
        list: z.array(neteaseJobSchema),
        lastPage: z.boolean(),
      })
      .loose(),
  })
  .loose();
