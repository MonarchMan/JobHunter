import { z } from 'zod';

export const pinduoduoConfigSchema = z
  .object({
    pageSize: z.number().int().min(1).max(100).default(10),
    token: z.string().nullable().default(null),
  })
  .strict();

export type PinduoduoConfig = z.infer<typeof pinduoduoConfigSchema>;

export const pinduoduoJobSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    code: z.string().min(1),
    workLocation: z.string().nullable().optional(),
    workLocationName: z.string().nullable().optional(),
    job: z.string().nullable().optional(),
    jobName: z.string().nullable().optional(),
    releaseTime: z.coerce.number().int().nonnegative().nullable().optional(),
    jobDuty: z.string().nullable().optional(),
    labelList: z.array(z.string()).nullable().optional(),
    recruitTypeName: z.string().nullable().optional(),
    graduationYear: z.string().nullable().optional(),
  })
  .loose();

export type PinduoduoJob = z.infer<typeof pinduoduoJobSchema>;

export const pinduoduoListResponseSchema = z
  .object({
    success: z.literal(true),
    errorCode: z.number(),
    errorMsg: z.string().nullable(),
    result: z
      .object({
        list: z.array(pinduoduoJobSchema),
        total: z.coerce.number().int().nonnegative(),
      })
      .loose(),
  })
  .loose();

export type PinduoduoListResponse = z.infer<typeof pinduoduoListResponseSchema>;
