import { z } from 'zod';

/**
 * Runtime values needed by the endpoints copied from the local reference
 * scripts. Secrets and browser session state are deliberately not part of the
 * schema; short-lived provider-issued values may be supplied by the caller.
 */
export const scriptedConfigSchema = z
  .object({
    pageSize: z.number().int().min(1).max(100).default(10),
    keyword: z.string().default(''),
    batchId: z.number().int().positive().default(100000560002),
    channel: z.string().default('campus_group_official_site'),
    language: z.string().default('zh'),
    csrfToken: z.string().min(1).nullable().default(null),
    portalType: z.number().int().positive().default(2),
    portalEntrance: z.number().int().positive().default(1),
    signature: z.string().min(1).nullable().default(null),
    subjectIdList: z.array(z.string().min(1)).default([]),
    planIdList: z.array(z.string().min(1)).default(['45']),
    hwId: z.string().min(1).default('app_000000035886'),
    jobType: z.string().default('CR'),
    recruitmentType: z.array(z.string().min(1)).default(['INTERN']),
    xS: z.string().min(1).nullable().default(null),
    xSCommon: z.string().min(1).nullable().default(null),
    xT: z.string().min(1).nullable().default(null),
  })
  .strict();

export type ScriptedConfig = z.infer<typeof scriptedConfigSchema>;
