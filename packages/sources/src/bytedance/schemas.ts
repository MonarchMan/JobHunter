import { z } from 'zod';

export const byteDanceJobSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    description: z.string().min(1),
    location: z.string().nullable().optional(),
    employmentType: z.string().nullable().optional(),
    detailUrl: z.url({ protocol: /^https$/ }),
  })
  .loose();

export type ByteDanceJob = z.infer<typeof byteDanceJobSchema>;
