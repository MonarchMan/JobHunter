import { z } from 'zod';

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
export type Qihoo360Job = z.infer<typeof qihoo360JobSchema>;

export const qihoo360DetailSchema = qihoo360JobSchema
  .extend({
    description: z.string().min(1),
    qualification: z.string().nullable().optional(),
    year: z.string().nullable().optional(),
  })
  .loose();
export type Qihoo360Detail = z.infer<typeof qihoo360DetailSchema>;

export const qihoo360DetailResponseSchema = z
  .object({ code: z.literal(0), data: qihoo360DetailSchema })
  .loose();
