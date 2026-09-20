import { z } from 'zod';

/** 前后端共享的纯清理策略契约，不依赖进程、文件或任务执行器。 */
export const platformRetentionPolicySchema = z
  .object({
    retentionDays: z.number().int().min(1).max(3650),
    intervalHours: z.number().int().min(1).max(720),
  })
  .strict();

/** 只允许安全设置投影进入客户端，不含确认令牌。 */
export const platformRetentionSummarySchema = z
  .object({
    enabled: z.boolean(),
    policy: platformRetentionPolicySchema,
  })
  .strict();
export type PlatformRetentionSummary = z.infer<typeof platformRetentionSummarySchema>;
