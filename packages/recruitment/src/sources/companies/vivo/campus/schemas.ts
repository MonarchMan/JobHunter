import { z } from 'zod';

/** vivo 校园招聘接口配置 Schema。 */
export const vivoCampusConfigSchema = z
  .object({
    pageSize: z.number().int().min(1).max(300).default(300),
    keyword: z.string().default(''),
  })
  .strict();

/** 来源适配器使用的类型约束。 */
export type VivoCampusConfig = z.infer<typeof vivoCampusConfigSchema>;

/** 来源输入或输出的运行时校验 Schema。 */
export const vivoCampusJobSchema = z
  .object({
    Id: z.uuid(),
    JobAdId: z.number().int().positive(),
    JobAdName: z.string().min(1),
    Category: z.string().min(1),
    CategoryId: z.enum(['2', '3']),
    LocNames: z.array(z.string().min(1)),
    Duty: z.string().nullable().optional(),
    Require: z.string().nullable().optional(),
    HeadCount: z.number().int().nonnegative().nullable().optional(),
    ChangeDate: z.string().nullable().optional(),
  })
  .loose();

/** 来源适配器使用的类型约束。 */
export type VivoCampusJob = z.infer<typeof vivoCampusJobSchema>;

/** 来源输入或输出的运行时校验 Schema。 */
export const vivoCampusListSchema = z
  .object({
    Code: z.literal(200),
    Count: z.number().int().nonnegative(),
    Data: z.array(vivoCampusJobSchema),
  })
  .loose();
