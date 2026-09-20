import { z } from 'zod';
import type { TaskHandler } from './tasks/model.js';
import { TaskExecutionError } from './tasks/retry-policy.js';
import { platformRetentionPolicySchema } from './contracts/platform-retention.js';
export { platformRetentionPolicySchema } from './contracts/platform-retention.js';

/** 持久控制状态只含策略和短期确认，不备份职位正文。 */
export const platformRetentionStateSchema = z
  .object({
    policy: platformRetentionPolicySchema,
    enabled: z.boolean(),
    lastRunAt: z.number().int().nullable(),
    preview: z
      .object({
        token: z.uuid(),
        expiresAt: z.number().int(),
        policy: platformRetentionPolicySchema,
      })
      .strict()
      .nullable(),
  })
  .strict();
/** 启用必须消费预览令牌；touch 只能由明确用户操作提交。 */
export const platformRetentionCommandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('preview'), policy: platformRetentionPolicySchema }).strict(),
  z.object({ action: z.literal('enable'), confirmationToken: z.uuid() }).strict(),
  z.object({ action: z.enum(['disable', 'status', 'run']) }).strict(),
  z.object({ action: z.literal('touch'), jobId: z.uuidv7() }).strict(),
]);
export type PlatformRetentionCommand = z.infer<typeof platformRetentionCommandSchema>;
/** 仅返回计数和控制状态，不返回被清理内容。 */
export const platformRetentionResultSchema = z
  .object({
    enabled: z.boolean(),
    policy: platformRetentionPolicySchema,
    eligible: z.number().int().nonnegative(),
    protected: z.number().int().nonnegative(),
    deleted: z.number().int().nonnegative(),
    skipped: z.boolean().optional(),
    warning: z.string().optional(),
    confirmationToken: z.uuid().optional(),
    expiresAt: z.number().int().optional(),
  })
  .strict();
export type PlatformRetentionResult = z.infer<typeof platformRetentionResultSchema>;
/** 仓储须在同一写事务复核策略、时间与全部保护引用。 */
export interface PlatformRetentionRepository {
  execute(command: PlatformRetentionCommand, now: number): PlatformRetentionResult;
}
/** 维护复用现有任务调度，不做网络或物理 VACUUM。 */
export function createPlatformRetentionTaskHandler(
  repository: PlatformRetentionRepository,
): TaskHandler<PlatformRetentionCommand, PlatformRetentionResult> {
  return {
    taskType: 'platform.retention',
    payloadSchema: platformRetentionCommandSchema,
    outputSchema: platformRetentionResultSchema,
    defaultMaxAttempts: 1,
    leaseDurationMs: 60_000,
    concurrencyKey: () => 'platform:retention',
    lateCancellationPolicy: 'complete',
    execute(context, command) {
      // 1、同步短事务开始前响应取消；已提交删除不伪装成未执行。
      context.signal.throwIfAborted();
      try {
        return Promise.resolve(repository.execute(command, context.clock.now()));
      } catch {
        throw new TaskExecutionError(
          'permanent',
          'Platform retention failed; preview again or inspect database health.',
        );
      }
    },
  };
}
