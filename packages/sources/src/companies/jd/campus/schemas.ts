import { z } from 'zod';

export const jdCampusConfigSchema = z
  .object({
    pageSize: z.number().int().min(1).max(100).default(10),
    keyword: z.string().default(''),
    planIdList: z.array(z.string().min(1)).min(1).default(['45']),
  })
  .strict();

export type JdCampusConfig = z.infer<typeof jdCampusConfigSchema>;

const jdCampusRequirementSchema = z
  .object({
    workCity: z.string().nullable().optional(),
    positionBg: z.string().nullable().optional(),
    positionDept: z.string().nullable().optional(),
  })
  .loose();

export const jdCampusJobSchema = z
  .object({
    publishId: z.number().int().positive(),
    reqId: z.number().int().positive(),
    positionDept: z.string().nullable().optional(),
    positionName: z.string().nullable().optional(),
    positionNameOpen: z.string().nullable().optional(),
    workCity: z.string().nullable().optional(),
    publishTime: z.coerce.number().int().nonnegative().nullable().optional(),
    jobDirection: z.string().nullable().optional(),
    workContent: z.string().nullable().optional(),
    qualification: z.string().nullable().optional(),
    requirementVoList: z.array(jdCampusRequirementSchema).nullable().optional(),
    jobCategory: z.string().nullable().optional(),
    planId: z.number().int().positive().nullable().optional(),
    education: z.string().nullable().optional(),
    workYears: z.string().nullable().optional(),
    reqTagList: z.array(z.unknown()).nullable().optional(),
  })
  .loose();

export type JdCampusJob = z.infer<typeof jdCampusJobSchema>;

export const jdCampusListResponseSchema = z
  .object({
    success: z.literal(true),
    body: z
      .object({
        totalNumber: z.coerce.number().int().nonnegative(),
        items: z.array(jdCampusJobSchema),
      })
      .loose(),
  })
  .loose();

export type JdCampusListResponse = z.infer<typeof jdCampusListResponseSchema>;
