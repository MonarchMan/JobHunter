import { z } from 'zod';

export const vivoSocialConfigSchema = z
  .object({
    pageSize: z.number().int().min(1).max(100).default(100),
    keyword: z.string().default(''),
  })
  .strict();
export type VivoSocialConfig = z.infer<typeof vivoSocialConfigSchema>;

const vivoLocationSchema = z
  .object({ city: z.string().min(1), location: z.string().nullable().optional() })
  .loose();
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
export type VivoSocialJob = z.infer<typeof vivoSocialJobSchema>;

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
