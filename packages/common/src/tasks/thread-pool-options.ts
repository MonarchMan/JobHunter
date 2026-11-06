import { z } from 'zod';

/** 四类容量分别配置；时间参数受边界校验，min=max 可退化为固定池。 */
export const threadPoolOptionsSchema = z
  .object({
    minThreads: z.number().int().min(1).max(32).default(1),
    maxThreads: z.number().int().min(1).max(32).default(4),
    maxTasksPerThread: z.number().int().min(1).max(64).default(4),
    maxActiveTasks: z.number().int().min(1).max(256).default(8),
    scaleUpCooldownMs: z.number().int().min(0).max(2_147_483_647).default(5_000),
    idleTimeoutMs: z.number().int().min(100).max(2_147_483_647).default(120_000),
    startupTimeoutMs: z.number().int().min(100).max(2_147_483_647).default(90_000),
    shutdownGraceMs: z.number().int().min(0).max(2_147_483_647).default(10_000),
    heartbeatTimeoutMs: z.number().int().min(10_000).max(2_147_483_647).default(45_000),
  })
  .strict()
  .refine((value) => value.minThreads <= value.maxThreads, 'minThreads must not exceed maxThreads');
/** 经边界校验的线程池预算及生命周期时间，运行期间不允许修改。 */
export type ThreadPoolOptions = Readonly<z.infer<typeof threadPoolOptionsSchema>>;
