import { z } from 'zod';

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

export type XiaohongshuCampusJob = z.infer<typeof xiaohongshuCampusJobSchema>;

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
