import { z } from 'zod';

export const huaweiCampusJobSchema = z
  .object({
    id: z.string().min(1),
    jobId: z.union([z.string().min(1), z.number().int()]),
    jobName: z.string().min(1),
    jobAddress: z.string().nullable().optional(),
    jobDesc: z.string().min(1),
    jobRequire: z.string().nullable().optional(),
    categoryName: z.string().nullable().optional(),
    deptName: z.string().nullable().optional(),
    lastUpdateDate: z.string().nullable().optional(),
  })
  .loose();

export type HuaweiCampusJob = z.infer<typeof huaweiCampusJobSchema>;
