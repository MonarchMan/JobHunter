import { z } from 'zod';

export const jdConfigSchema = z
  .object({
    pageSize: z.number().int().min(1).max(100).default(100),
    keyword: z.string().default(''),
  })
  .strict();

export type JdConfig = z.infer<typeof jdConfigSchema>;

export const jdJobSchema = z
  .object({
    requirementId: z.number().int().positive(),
    positionId: z.number().int().positive(),
    positionCode: z.string().min(1),
    positionNameOpen: z.string().min(1),
    positionName: z.string().nullable().optional(),
    positionDeptName: z.string().nullable().optional(),
    jobType: z.string().nullable().optional(),
    workCity: z.string().nullable().optional(),
    workCityCode: z.string().nullable().optional(),
    publishTime: z.number().int().nonnegative().nullable().optional(),
    formatPublishTime: z.string().nullable().optional(),
    workContent: z.string().nullable().optional(),
    qualification: z.string().nullable().optional(),
    jobTypeCode: z.string().nullable().optional(),
  })
  .loose();

export type JdJob = z.infer<typeof jdJobSchema>;

export const jdListResponseSchema = z.array(jdJobSchema);

export type JdListResponse = z.infer<typeof jdListResponseSchema>;
