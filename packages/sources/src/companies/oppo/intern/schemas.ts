import { z } from 'zod';

export const oppoInternConfigSchema = z
  .object({
    pageSize: z.number().int().min(1).max(300).default(100),
    keyword: z.string().default(''),
  })
  .strict();
export type OppoInternConfig = z.infer<typeof oppoInternConfigSchema>;

export const oppoInternJobSchema = z
  .object({
    idRecruitPosition: z.number().int().positive(),
    projectId: z.union([z.literal(29), z.literal(30), z.literal(31)]),
    atsProjectPositionId: z.number().int().positive(),
    projectName: z.string().min(1),
    recruitmentTypeName: z.string().min(1),
    recruitmentType: z.enum(['Intern', 'Graduate', 'doctor']),
    positionTypeName: z.string().nullable().optional(),
    positionName: z.string().min(1),
    positionDesc: z.string().min(1),
    positionRequire: z.string().min(1),
    workCityName: z.string().nullable().optional(),
    releaseTime: z.string().nullable().optional(),
  })
  .loose();
export type OppoInternJob = z.infer<typeof oppoInternJobSchema>;

export const oppoInternListSchema = z
  .object({
    code: z.literal(0),
    data: z
      .object({
        records: z.array(oppoInternJobSchema),
        total: z.number().int().nonnegative(),
        size: z.number().int().positive(),
        current: z.number().int().positive(),
        pages: z.number().int().nonnegative(),
      })
      .loose(),
  })
  .loose();
