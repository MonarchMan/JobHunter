import { z } from 'zod';

export const alibabaCampusJobSchema = z
  .object({
    id: z.string().min(1),
    positionName: z.string().min(1),
    workCity: z.string().nullable().optional(),
    workContent: z.string().min(1),
    publishTime: z.string().nullable().optional(),
  })
  .loose();

export type AlibabaCampusJob = z.infer<typeof alibabaCampusJobSchema>;
