import { z } from 'zod';

/** vivo 社会招聘接口配置 Schema。 */
export const vivoSocialConfigSchema = z
  .object({
    pageSize: z.number().int().min(1).max(100).default(100),
    keyword: z.string().default(''),
  })
  .strict();
/** 来源适配器使用的类型约束。 */
export type VivoSocialConfig = z.infer<typeof vivoSocialConfigSchema>;

const vivoLocationSchema = z
  .object({ city: z.string().min(1), location: z.string().nullable().optional() })
  .loose();
/** 来源输入或输出的运行时校验 Schema。 */
export const vivoSocialJobSchema = z
  .object({
    job_id: z.string().min(1),
    job_code: z.string().min(1),
    job_title: z.string().min(1),
    requirement_org_name: z.string().nullable().optional(),
    degree_range_name: z.string().nullable().optional(),
    yoe_min: z.number().int(),
    yoe_max: z.number().int(),
    job_location_list: z.array(vivoLocationSchema),
    job_desc: z.string().min(1),
    job_category_id: z.string().min(1),
    job_category: z.string().nullable().optional(),
    publish_timestamp: z.number().int().nonnegative().nullable().optional(),
  })
  .loose();
/** 来源适配器使用的类型约束。 */
export type VivoSocialJob = z.infer<typeof vivoSocialJobSchema>;

/** 来源输入或输出的运行时校验 Schema。 */
export const vivoSocialListSchema = z
  .object({
    code: z.literal(0),
    success: z.literal(true),
    data: z.array(vivoSocialJobSchema),
    meta: z
      .object({ page: z.number().int().positive(), total: z.number().int().nonnegative() })
      .loose(),
  })
  .loose();
