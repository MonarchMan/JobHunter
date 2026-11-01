import { z } from 'zod';

/** 360 社会招聘接口配置 Schema。 */
export const qihoo360ConfigSchema = z
  .object({ pageSize: z.literal(10_000).default(10_000) })
  .strict();
export type Qihoo360Config = z.infer<typeof qihoo360ConfigSchema>;

export const qihoo360JobSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    type: z.string().nullable().optional(),
    position: z.string().nullable().optional(),
    area: z.string().nullable().optional(),
    date: z.string().nullable().optional(),
  })
  .loose();
/** 来源适配器使用的类型约束。 */
export type Qihoo360Job = z.infer<typeof qihoo360JobSchema>;

/** 来源输入或输出的运行时校验 Schema。 */
export const qihoo360DetailSchema = qihoo360JobSchema
  .extend({
    description: z.string().min(1),
    qualification: z.string().nullable().optional(),
    year: z.string().nullable().optional(),
  })
  .loose();
/** 来源适配器使用的类型约束。 */
export type Qihoo360Detail = z.infer<typeof qihoo360DetailSchema>;

/** 来源输入或输出的运行时校验 Schema。 */
export const qihoo360DetailResponseSchema = z
  .object({ code: z.literal(0), data: qihoo360DetailSchema })
  .loose();
