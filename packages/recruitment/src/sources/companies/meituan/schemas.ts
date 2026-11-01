import { z } from 'zod';

/** 美团招聘接口配置 Schema。 */
export const meituanConfigSchema = z
  .object({
    pageSize: z.number().int().min(1).max(200).default(100),
    jobShareType: z.literal('1').default('1'),
    keywords: z.string().default(''),
  })
  .strict();

/** 来源适配器使用的类型约束。 */
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

/** 来源输入或输出的运行时校验 Schema。 */
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

/** 来源适配器使用的类型约束。 */
export type MeituanJob = z.infer<typeof meituanJobSchema>;

/** 来源输入或输出的运行时校验 Schema。 */
export const meituanPageSchema = z
  .object({
    pageNo: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    totalPage: z.number().int().nonnegative(),
    totalCount: z.number().int().nonnegative(),
  })
  .loose();

/** 来源适配器使用的类型约束。 */
export type MeituanPage = z.infer<typeof meituanPageSchema>;

const meituanListDataSchema = z
  .object({
    list: z.array(meituanJobSchema),
    page: meituanPageSchema,
  })
  .loose();

/** 来源输入或输出的运行时校验 Schema。 */
export const meituanListResponseSchema = z
  .object({
    data: meituanListDataSchema,
    status: z.literal(1),
    message: z.string(),
  })
  .loose();

/** 来源适配器使用的类型约束。 */
export type MeituanListResponse = z.infer<typeof meituanListResponseSchema>;

/** 来源输入或输出的运行时校验 Schema。 */
export const meituanDetailResponseSchema = z
  .object({
    data: meituanJobSchema,
    status: z.literal(1),
    message: z.string(),
  })
  .loose();

/** 来源适配器使用的类型约束。 */
export type MeituanDetail = z.infer<typeof meituanDetailResponseSchema>['data'];
