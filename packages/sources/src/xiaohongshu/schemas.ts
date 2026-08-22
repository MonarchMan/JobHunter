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
