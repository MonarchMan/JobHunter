import { z } from 'zod';
import {
  PlatformError,
  type PlatformJobDetail,
  type PlatformSession,
  type PlatformSessionProvider,
  type PlatformProviderKey,
} from '@jobhunter/platform-core';
import type { TaskHandler } from './tasks/model.js';
import { TaskExecutionError } from './tasks/retry-policy.js';

/** 任务只保存非敏感连接选择和稳定职位身份，不接受 URL、Cookie 或私有游标。 */
export const bossCommandSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('connect'),
      portFile: z.string().min(1),
      targetId: z.string().min(1),
      acquisitionMode: z.enum(['http', 'browser']).optional(),
    })
    .strict(),
  z.object({ action: z.literal('next'), generation: z.number().int().positive() }).strict(),
  z
    .object({
      action: z.literal('detail'),
      generation: z.number().int().positive(),
      externalJobId: z.string().min(1).max(512),
    })
    .strict(),
  z.object({ action: z.literal('disconnect'), generation: z.number().int().positive() }).strict(),
]);
export type BossCommand = z.infer<typeof bossCommandSchema>;

/** 对外结果经过白名单校验，禁止将连接上下文混入任务结果。 */
export const bossResultSchema = z
  .object({
    generation: z.number().int().positive(),
    status: z.enum(['connected', 'available', 'disconnected', 'saved']),
    hasMore: z.boolean().optional(),
    skippedMissingCompanyId: z.number().int().nonnegative().optional(),
    jobId: z.string().optional(),
    savedCount: z.number().int().nonnegative().optional(),
    candidates: z
      .array(
        z
          .object({
            externalJobId: z.string(),
            externalCompanyId: z.string(),
            title: z.string(),
            company: z.string(),
            city: z.string(),
            salary: z.string(),
            experience: z.string(),
            education: z.string(),
            sourceUrl: z.url(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();
export type BossResult = z.infer<typeof bossResultSchema>;

/** 平台持久化端口负责代次及取消的事务内复核，并复用正式职位模型。 */
export interface PlatformRepository {
  reset(now: number): number;
  generation(): number | null;
  setStatus(
    generation: number,
    status:
      | 'connected'
      | 'available'
      | 'disconnected'
      | 'unavailable'
      | 'access_blocked'
      | 'rate_limited',
    now: number,
  ): void;
  save(detail: PlatformJobDetail, generation: number, taskId: string, now: number): string;
}

/** 单平台浏览服务；每实例独占会话，私有上下文从不进入持久任务。 */
export class PlatformBrowsingService {
  #session: PlatformSession | null = null;
  #generation: number | null = null;
  #busy = false;
  #failed = false;
  public constructor(
    private readonly provider: PlatformSessionProvider,
    private readonly repository: PlatformRepository,
    private readonly now: () => number = Date.now,
  ) {}

  /** Worker 停止时立即取消网络并释放凭据。 */
  public close(): void {
    this.#session?.disconnect();
    if (this.#generation !== null)
      this.repository.setStatus(this.#generation, 'disconnected', this.now());
    this.#session = null;
    this.#generation = null;
    this.#failed = false;
  }

  /** Worker 启动时废弃上次进程持有的游标与持久状态。 */
  public initialize(): void {
    this.close();
    this.repository.reset(this.now());
  }

  /** 执行一次用户动作，网络结束后再次检查取消与连接代次。 */
  public async execute(
    command: BossCommand,
    taskId: string,
    signal: AbortSignal,
  ): Promise<BossResult> {
    if (this.#busy) throw new PlatformError('session_unavailable');
    // 旧客户端动作不得销毁当前有效连接。
    if (command.action !== 'connect' && this.repository.generation() !== command.generation)
      throw new PlatformError('session_unavailable');
    if (this.#failed && (command.action === 'next' || command.action === 'detail'))
      throw new PlatformError('session_unavailable');
    this.#busy = true;
    try {
      signal.throwIfAborted();
      // 1、连接总是新代次，旧游标不能用于另一个账号或重启后的进程。
      if (command.action === 'connect') {
        this.close();
        const generation = this.repository.reset(this.now());
        this.#generation = generation;
        const session = await this.provider.connect(command, signal);
        if (signal.aborted || this.repository.generation() !== generation) {
          session.disconnect();
          throw new PlatformError('session_unavailable');
        }
        this.#session = session;
        this.repository.setStatus(generation, 'connected', this.now());
        return { generation, status: 'connected' };
      }
      const generation = command.generation;
      if (this.repository.generation() !== generation)
        throw new PlatformError('session_unavailable');
      if (command.action === 'disconnect') {
        this.close();
        const next = this.repository.reset(this.now());
        this.repository.setStatus(next, 'disconnected', this.now());
        return { generation: next, status: 'disconnected' };
      }
      if (!this.#session || this.#generation !== generation || this.#failed)
        throw new PlatformError('session_unavailable');
      // 2、每批串行补齐正文并逐条提交；失败即停止，已提交职位不回滚。
      if (command.action === 'next') {
        const result = await this.#session.readNext(signal);
        signal.throwIfAborted();
        if (this.repository.generation() !== generation)
          throw new PlatformError('session_unavailable');
        let savedCount = 0;
        for (const candidate of result.candidates) {
          // 2.a、网络前后复核取消和代次，旧会话不得继续请求或提交。
          signal.throwIfAborted();
          if (this.repository.generation() !== generation)
            throw new PlatformError('session_unavailable');
          const detail = await this.#session.readDetail(candidate.externalJobId, signal);
          signal.throwIfAborted();
          if (this.repository.generation() !== generation)
            throw new PlatformError('session_unavailable');
          // 2.b、完整事实才入库；仓储短事务复核租约，不包裹任何网络请求。
          this.repository.save(detail, generation, taskId, this.now());
          savedCount += 1;
        }
        this.repository.setStatus(generation, 'available', this.now());
        return {
          generation,
          status: 'available',
          hasMore: result.hasMore,
          savedCount,
          candidates: [...result.candidates],
          skippedMissingCompanyId: result.skippedMissingCompanyId,
        };
      }
      const detail = await this.#session.readDetail(command.externalJobId, signal);
      signal.throwIfAborted();
      // 3、仓储在事务内校验任务仍持有租约且未取消，原子保存职位和观察。
      const jobId = this.repository.save(detail, generation, taskId, this.now());
      return { generation, status: 'saved', jobId };
    } catch (error) {
      // 4、失败冻结后续动作，但保留同一 CDP 授权；只在显式断开或退出时关闭。
      this.#failed = true;
      if (this.#generation !== null)
        this.repository.setStatus(
          this.#generation,
          error instanceof PlatformError && error.category === 'access_blocked'
            ? 'access_blocked'
            : error instanceof PlatformError && error.category === 'rate_limited'
              ? 'rate_limited'
              : 'unavailable',
          this.now(),
        );
      throw error;
    } finally {
      this.#busy = false;
    }
  }
}

/** 注册单次平台动作，禁止上游失败自动重试形成请求循环。 */
export function createBossPlatformTaskHandler(
  service: Pick<PlatformBrowsingService, 'execute'>,
): TaskHandler<BossCommand, BossResult> {
  return createPlatformTaskHandler('boss', service);
}

/** 由可信装配选择平台，客户端 payload 不允许覆盖 provider 或并发域。 */
export function createPlatformTaskHandler(
  providerKey: PlatformProviderKey,
  service: Pick<PlatformBrowsingService, 'execute'>,
): TaskHandler<BossCommand, BossResult> {
  return {
    taskType: `platform.${providerKey}`,
    payloadSchema: bossCommandSchema,
    outputSchema: bossResultSchema,
    defaultMaxAttempts: 1,
    leaseDurationMs: 60_000,
    concurrencyKey: () => `platform:${providerKey}`,
    lateCancellationPolicy: (result) => (result.status === 'saved' ? 'complete' : 'cancel'),
    async execute(context, payload) {
      if (!context.taskId)
        throw new TaskExecutionError('invalid_config', 'Platform task ID is required.');
      try {
        return await service.execute(payload, context.taskId, context.signal);
      } catch (error) {
        if (context.signal.aborted)
          throw new TaskExecutionError('cancelled', 'Platform request cancelled.');
        throw new TaskExecutionError(
          'permanent',
          error instanceof PlatformError
            ? error.message
            : 'Platform operation failed. Reconnect or inspect local database health.',
        );
      }
    },
  };
}

/** 保留既有 BOSS 装配名称与任务协议兼容。 */
export { PlatformBrowsingService as BossPlatformService };
