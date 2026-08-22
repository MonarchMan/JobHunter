import { z } from 'zod';

export const meituanConfigSchema = z
  .object({
    pageSize: z.number().int().min(1).max(100).default(100),
    jobShareType: z.literal('1').default('1'),
    keywords: z.string().default(''),
  })
  .strict();

export type MeituanConfig = z.infer<typeof meituanConfigSchema>;

const meituanCitySchema = z
  .object({
    code: z.string().nullable().optional(),
    name: z.string().min(1),
  })
  .loose();

const meituanDepartmentSchema = z
  .object({
    code: z.string().nullable().optional(),
    name: z.string().min(1),
  })
  .loose();

export const meituanJobSchema = z
  .object({
    jobUnionId: z.string().min(1),
    name: z.string().min(1),
    jobType: z.string().min(1),
    jobStatus: z.string().min(1),
    jobFamily: z.string().nullable().optional(),
    jobFamilyGroup: z.string().nullable().optional(),
    cityList: z.array(meituanCitySchema).default([]),
    department: z.array(meituanDepartmentSchema).default([]),
    workYear: z.string().nullable().optional(),
    desc: z.string().nullable().optional(),
    departmentIntro: z.string().nullable().optional(),
    jobDuty: z.string().nullable().optional(),
    jobRequirement: z.string().nullable().optional(),
    precedence: z.string().nullable().optional(),
    highLight: z.string().nullable().optional(),
    firstPostTime: z.number().int().nonnegative().nullable().optional(),
    refreshTime: z.number().int().nonnegative().nullable().optional(),
    expiredTime: z.number().int().nonnegative().nullable().optional(),
    jobSpecialCode: z.string().nullable().optional(),
    jobSource: z.string().nullable().optional(),
  })
  .loose();

export type MeituanJob = z.infer<typeof meituanJobSchema>;

export const meituanPageSchema = z
  .object({
    pageNo: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    totalPage: z.number().int().nonnegative(),
    totalCount: z.number().int().nonnegative(),
  })
  .loose();

export type MeituanPage = z.infer<typeof meituanPageSchema>;

const meituanListDataSchema = z
  .object({
    list: z.array(meituanJobSchema),
    page: meituanPageSchema,
  })
  .loose();

export const meituanListResponseSchema = z
  .object({
    data: meituanListDataSchema,
    status: z.literal(1),
    message: z.string(),
  })
  .loose();

export type MeituanListResponse = z.infer<typeof meituanListResponseSchema>;

export const meituanDetailResponseSchema = z
  .object({
    data: meituanJobSchema,
    status: z.literal(1),
    message: z.string(),
  })
  .loose();

export type MeituanDetail = z.infer<typeof meituanDetailResponseSchema>['data'];
