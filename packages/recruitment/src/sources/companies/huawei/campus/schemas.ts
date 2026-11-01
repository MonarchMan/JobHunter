import { z } from 'zod';

/** 华为校园招聘职位响应 Schema。 */
export const huaweiCampusJobSchema = z
  .object({
    id: z.string().min(1),
    jobId: z.union([z.string().min(1), z.number().int()]),
    advertisementId: z.union([z.string().min(1), z.number().int().positive()]),
    jobName: z.string().min(1),
    jobAddress: z.string().nullable().optional(),
    jobDesc: z.string().min(1).nullable().optional(),
    jobRequire: z.string().nullable().optional(),
    categoryName: z.string().nullable().optional(),
    deptName: z.string().nullable().optional(),
    lastUpdateDate: z.string().nullable().optional(),
  })
  .loose();

/** 来源适配器使用的类型约束。 */
export type HuaweiCampusJob = z.infer<typeof huaweiCampusJobSchema>;
