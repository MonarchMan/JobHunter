import { z } from 'zod';

/** 网易校园招聘接口配置 Schema。 */
export const neteaseCampusConfigSchema = z
  .object({
    pageSize: z.number().int().min(1).max(100).default(50),
    keyword: z.string().default(''),
  })
  .strict();
/** 来源适配器使用的类型约束。 */
export type NeteaseCampusConfig = z.infer<typeof neteaseCampusConfigSchema>;

/** 来源输入或输出的运行时校验 Schema。 */
export const neteaseCampusJobSchema = z
  .object({
    id: z.number().int().positive(),
    positionName: z.string().min(1),
    projectId: z.number().int().positive(),
    positionTypeName: z.string().nullable().optional(),
    workPlaceName: z.string().nullable().optional(),
    positionDescription: z.string().min(1),
    positionRequirement: z.string().min(1),
    updateTime: z.number().int().nonnegative().nullable().optional(),
  })
  .loose();
/** 来源适配器使用的类型约束。 */
export type NeteaseCampusJob = z.infer<typeof neteaseCampusJobSchema>;

/** 来源输入或输出的运行时校验 Schema。 */
export const neteaseCampusListSchema = z
  .object({
    code: z.literal(200),
    data: z
      .object({
        total: z.number().int().nonnegative(),
        pages: z.number().int().nonnegative(),
        list: z.array(neteaseCampusJobSchema),
      })
      .loose(),
  })
  .loose();

/** 来源输入或输出的运行时校验 Schema。 */
export const neteaseLeihuoJobSchema = z
  .object({
    job_code: z.string().min(1),
    job_name: z.string().min(1),
    job_description: z.string().min(1),
    job_requirement: z.string().min(1),
    ehr_job_id: z.string().min(1),
    category_name: z.string().nullable().optional(),
    department_name: z.array(z.string().min(1)).nullable().optional(),
    work_place_name: z.string().nullable().optional(),
    job_detail_url: z.url({ protocol: /^https$/ }),
  })
  .loose();
/** 来源适配器使用的类型约束。 */
export type NeteaseLeihuoJob = z.infer<typeof neteaseLeihuoJobSchema>;

/** 来源输入或输出的运行时校验 Schema。 */
export const neteaseLeihuoListSchema = z
  .object({
    status: z.literal(200),
    data: z
      .object({
        pages_count: z.number().int().nonnegative(),
        count_number: z.number().int().nonnegative(),
        apply_job_list: z.array(neteaseLeihuoJobSchema),
      })
      .loose(),
  })
  .loose();
