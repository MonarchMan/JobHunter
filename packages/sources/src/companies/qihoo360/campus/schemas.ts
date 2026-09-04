import { z } from 'zod';

/** 360 校园招聘接口配置 Schema。 */
export const qihoo360CampusConfigSchema = z
  .object({
    pageSize: z.number().int().min(1).max(300).default(100),
    keyword: z.string().default(''),
  })
  .strict();
/** 来源适配器使用的类型约束。 */
export type Qihoo360CampusConfig = z.infer<typeof qihoo360CampusConfigSchema>;

/** 来源输入或输出的运行时校验 Schema。 */
export const qihoo360CampusJobSchema = z
  .object({
    Id: z.uuid(),
    JobAdId: z.number().int().positive(),
    JobAdName: z.string().min(1),
    Category: z.string().min(1),
    CategoryId: z.enum(['2', '3']),
    LocNames: z.array(z.string().min(1)),
    Duty: z.string().nullable().optional(),
    Require: z.string().nullable().optional(),
    ChangeDate: z.string().nullable().optional(),
  })
  .loose();
/** 来源适配器使用的类型约束。 */
export type Qihoo360CampusJob = z.infer<typeof qihoo360CampusJobSchema>;

/** 来源输入或输出的运行时校验 Schema。 */
export const qihoo360CampusListSchema = z
  .object({
    Code: z.literal(200),
    Count: z.number().int().nonnegative(),
    Data: z.array(qihoo360CampusJobSchema),
  })
  .loose();
