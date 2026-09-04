import { z } from 'zod';

/** 阿里巴巴校园招聘职位响应 Schema。 */
export const alibabaCampusJobSchema = z
  .object({
    id: z.union([z.string().min(1), z.number().int().positive()]),
    positionName: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    workCity: z.string().nullable().optional(),
    workLocations: z.array(z.string().min(1)).nullable().optional(),
    workContent: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
    requirement: z.string().nullable().optional(),
    publishTime: z.union([z.string(), z.number().int().nonnegative()]).nullable().optional(),
  })
  .loose()
  .refine((value) => value.positionName !== undefined || value.name !== undefined, {
    message: 'Alibaba job record has no title field.',
  })
  .refine(
    (value) =>
      value.workContent !== undefined ||
      value.description !== undefined ||
      value.requirement !== undefined,
    {
      message: 'Alibaba job record has no description field.',
    },
  );

/** 来源适配器使用的类型约束。 */
export type AlibabaCampusJob = z.infer<typeof alibabaCampusJobSchema>;
