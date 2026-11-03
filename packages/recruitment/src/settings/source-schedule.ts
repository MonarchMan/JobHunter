import { z } from 'zod';

/** 单独计划只覆盖频率、时区与启停，来源和渠道的有效性仍由调度对账约束。 */
export const sourceScheduleSchema = z
  .object({
    cronExpression: z.string().trim().min(1).max(100),
    timezone: z.string().trim().min(1).max(100),
    enabled: z.boolean(),
  })
  .strict();
export type SourceScheduleOverride = z.infer<typeof sourceScheduleSchema>;
export const sourceScheduleOverridesSchema = z.record(z.uuid(), sourceScheduleSchema);
