import { z } from 'zod';

export const neteaseCampusConfigSchema = z
  .object({
    pageSize: z.number().int().min(1).max(100).default(50),
    keyword: z.string().default(''),
  })
  .strict();
export type NeteaseCampusConfig = z.infer<typeof neteaseCampusConfigSchema>;

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
export type NeteaseCampusJob = z.infer<typeof neteaseCampusJobSchema>;

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
export type NeteaseLeihuoJob = z.infer<typeof neteaseLeihuoJobSchema>;

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
