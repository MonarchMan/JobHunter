import { z } from 'zod';

/** 小米实习招聘接口配置 Schema。 */
export const xiaomiInternConfigSchema = z
  .object({
    pageSize: z.number().int().min(1).max(100).default(100),
    keyword: z.string().default(''),
  })
  .strict();
/** 来源适配器使用的类型约束。 */
export type XiaomiInternConfig = z.infer<typeof xiaomiInternConfigSchema>;

/** 来源输入或输出的运行时校验 Schema。 */
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
/** 来源适配器使用的类型约束。 */
export type XiaomiInternJob = z.infer<typeof xiaomiInternJobSchema>;

/** 来源输入或输出的运行时校验 Schema。 */
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
