import { z } from 'zod';

export const xiaomiInternConfigSchema = z
  .object({
    pageSize: z.number().int().min(1).max(100).default(100),
    keyword: z.string().default(''),
  })
  .strict();
export type XiaomiInternConfig = z.infer<typeof xiaomiInternConfigSchema>;

export const xiaomiInternJobSchema = z
  .object({
    title: z.string().min(1),
    cityZhNames: z.array(z.string()),
    levelOneDeptName: z.string().nullable().optional(),
    description: z.string().min(1),
    requirement: z.string().min(1),
    publishTime: z.string().nullable().optional(),
    larkJobCode: z.string().nullable().optional(),
    type: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    url: z.url({ protocol: /^https$/ }),
    jobId: z.string().min(1),
    jobPostId: z.string().min(1),
  })
  .loose();
export type XiaomiInternJob = z.infer<typeof xiaomiInternJobSchema>;

export const xiaomiInternListSchema = z
  .object({
    code: z.literal(0),
    data: z
      .object({
        list: z.array(xiaomiInternJobSchema),
        pageSize: z.number().int().positive(),
        pageNum: z.number().int().positive(),
        pageTotal: z.number().int().nonnegative(),
        total: z.number().int().nonnegative(),
      })
      .loose(),
  })
  .loose();
