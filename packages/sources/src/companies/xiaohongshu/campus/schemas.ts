import { z } from 'zod';

/** 小红书校园招聘职位响应 Schema。 */
export const xiaohongshuCampusJobSchema = z
  .object({
    positionId: z.union([z.string().min(1), z.number().int()]),
    positionName: z.string().min(1),
    workplace: z.string().nullable().optional(),
    duty: z.string().min(1),
    qualification: z.string().nullable().optional(),
    publishTime: z.string().nullable().optional(),
  })
  .loose();

/** 来源适配器使用的类型约束。 */
export type XiaohongshuCampusJob = z.infer<typeof xiaohongshuCampusJobSchema>;

/** 来源输入或输出的运行时校验 Schema。 */
export const xiaohongshuListResponseSchema = z
  .object({
    success: z.literal(true),
    data: z
      .object({
        total: z.number().int().nonnegative(),
        totalPage: z.number().int().nonnegative(),
        pageNum: z.number().int().positive(),
        pageSize: z.number().int().positive(),
        list: z.array(xiaohongshuCampusJobSchema),
      })
      .loose(),
  })
  .loose();
