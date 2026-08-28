import { z } from 'zod';

export const vivoCampusConfigSchema = z
  .object({
    pageSize: z.number().int().min(1).max(300).default(300),
    keyword: z.string().default(''),
  })
  .strict();

export type VivoCampusConfig = z.infer<typeof vivoCampusConfigSchema>;

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

export type VivoCampusJob = z.infer<typeof vivoCampusJobSchema>;

export const vivoCampusListSchema = z
  .object({
    Code: z.literal(200),
    Count: z.number().int().nonnegative(),
    Data: z.array(vivoCampusJobSchema),
  })
  .loose();
