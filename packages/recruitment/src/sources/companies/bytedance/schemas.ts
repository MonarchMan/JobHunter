import { z } from 'zod';

/** 字节跳动职位响应 Schema。 */
export const byteDanceJobSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    description: z.string().min(1),
    location: z.string().nullable().optional(),
    city_list: z
      .array(z.object({ name: z.string().min(1) }).loose())
      .nullable()
      .optional(),
    job_category: z
      .object({
        name: z.string().min(1),
        parent: z.object({ name: z.string().nullable().optional() }).loose().nullable().optional(),
      })
      .loose()
      .nullable()
      .optional(),
    employmentType: z.string().nullable().optional(),
    recruit_type: z
      .object({
        name: z.string().min(1),
        en_name: z.string().nullable().optional(),
        parent: z.object({ name: z.string().nullable().optional() }).loose().nullable().optional(),
      })
      .loose()
      .nullable()
      .optional(),
    detailUrl: z.url({ protocol: /^https$/ }),
  })
  .loose()
  .transform((value) => ({
    ...value,
    employmentType:
      value.employmentType ??
      [value.recruit_type?.parent?.name, value.recruit_type?.name].filter(Boolean).join(' '),
    location:
      value.location ??
      value.city_list
        ?.map((city) => city.name)
        .filter(Boolean)
        .join('/') ??
      null,
    jobCategory: value.job_category?.parent?.name ?? value.job_category?.name ?? null,
  }));

/** 来源适配器使用的类型约束。 */
export type ByteDanceJob = z.infer<typeof byteDanceJobSchema>;
