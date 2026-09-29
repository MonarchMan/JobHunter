import { z } from 'zod';
import {
  PlatformError,
  PlatformTargetSelectionRequired,
  type PlatformJobDetail,
  type PlatformBatch,
  type PlatformSession,
  type PlatformSessionProvider,
  type PlatformProviderKey,
} from '@jobhunter/platform-core';
import type { TaskHandler } from './tasks/model.js';
import { TaskExecutionError } from './tasks/retry-policy.js';
import {
  platformProgressSchema,
  platformFailure,
  type PlatformProgress,
} from './platform-progress.js';

/** 智联首页初始化使用显式普通查询，不从实验记录推断用户意图。 */
const platformSearchSchema = z
  .object({
    keyword: z.string().trim().min(1).max(200),
    city: z
      .string()
      .regex(/^\d{0,12}$/)
      .default(''),
  })
  .strict();
/** 任务只保存非敏感连接选择和稳定职位身份，不接受 URL、Cookie 或私有游标。 */
export const bossCommandSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('connect'),
      portFile: z.string().min(1).optional(),
      targetId: z.string().min(1).optional(),
      acquisitionMode: z.enum(['http', 'browser']).optional(),
      search: platformSearchSchema.optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('acquire'),
      generation: z.number().int().positive().nullable(),
      reconnect: z.literal(true).optional(),
      search: platformSearchSchema.optional(),
      targetId: z
        .string()
        .regex(/^[\w-]{1,128}$/)
        .optional(),
    })
    .strict(),
  z.object({ action: z.literal('next'), generation: z.number().int().positive() }).strict(),
  z
    .object({
      action: z.literal('resume'),
      generation: z.number().int().positive(),
      sourceTaskId: z.uuid(),
      browserRecovered: z.literal(true),
    })
    .strict(),
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
    status: z.enum(['connected', 'available', 'disconnected', 'saved', 'selection_required']),
    targets: z
      .array(
        z.object({ id: z.string().regex(/^[\w-]{1,128}$/), label: z.string().max(100) }).strict(),
      )
      .max(30)
      .optional(),
    hasMore: z.boolean().optional(),
    skippedMissingCompanyId: z.number().int().nonnegative().optional(),
    jobId: z.string().optional(),
    savedCount: z.number().int().nonnegative().optional(),
    progress: platformProgressSchema.optional(),
    resumedFromTaskId: z.uuid().optional(),
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
  /** 仅为当前运行任务记录脱敏进度，取消时仍可保存已提交统计。 */
  recordProgress(taskId: string, generation: number, progress: PlatformProgress, now: number): void;
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
  #unsubscribe: (() => void) | undefined;
  #pending: {
    taskId: string;
    batch: PlatformBatch;
    saved: number;
    expiresAt: number;
    resumes: number;
  } | null = null;
  public constructor(
    private readonly provider: PlatformSessionProvider,
    private readonly repository: PlatformRepository,
    private readonly now: () => number = Date.now,
  ) {}

  /** Worker 停止时立即取消网络并释放凭据。 */
  public close(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    this.#session?.disconnect();
    if (this.#generation !== null)
      this.repository.setStatus(this.#generation, 'disconnected', this.now());
    this.#session = null;
    this.#generation = null;
    this.#failed = false;
    this.#pending = null;
  }

  /** Worker 启动时废弃上次进程持有的游标与持久状态。 */
  public initialize(): void {
    this.close();
    this.repository.reset(this.now());
  }

  /** 异步 CDP 回调可在任一 await 期间改变状态，不能依赖调用前的类型收窄。 */
  #connectionFailed(): boolean {
    return this.#failed;
  }

  /** 执行一次用户动作，网络结束后再次检查取消与连接代次。 */
  public async execute(
    command: BossCommand,
    taskId: string,
    signal: AbortSignal,
  ): Promise<BossResult> {
    if (this.#busy) throw new PlatformError('session_unavailable');
    // 旧客户端动作不得销毁当前有效连接。
    if (
      command.action !== 'connect' &&
      !(command.action === 'acquire' && command.reconnect) &&
      this.repository.generation() !== command.generation
    )
      throw new PlatformError('session_unavailable');
    // 0、仅显式重试授权替换冻结／丢失的会话；不自动处理安全验证。
    if (command.action === 'acquire' && command.reconnect) this.close();
    if (
      this.#failed &&
      (command.action === 'next' ||
        command.action === 'detail' ||
        (command.action === 'acquire' && this.#session))
    )
      throw new PlatformError('session_unavailable');
    // 0.a、日常动作复用现存会话，不允许选页参数悄悄替换正在使用的账号。
    if (command.action === 'acquire' && this.#session && (command.targetId || command.search))
      throw new PlatformError('session_unavailable');
    const acquire = command.action === 'acquire';
    if (command.action === 'acquire') {
      command =
        this.#session && this.#generation !== null
          ? { action: 'next', generation: this.#generation }
          : {
              action: 'connect',
              ...(command.targetId ? { targetId: command.targetId } : {}),
              ...(command.search ? { search: command.search } : {}),
            };
    }
    // 0、恢复只消费原失败任务的当前内存工作集；错误引用不改变现有状态。
    if (
      command.action === 'resume' &&
      (!this.#failed ||
        !this.#pending ||
        this.#pending.taskId !== command.sourceTaskId ||
        this.#pending.resumes >= 5 ||
        this.now() >= this.#pending.expiresAt ||
        !this.#session?.resume)
    )
      throw new PlatformError('session_unavailable');
    this.#busy = true;
    let stage: PlatformProgress['stage'];
    switch (command.action) {
      case 'connect':
        stage = 'connect';
        break;
      case 'detail':
        stage = 'detail';
        break;
      default:
        stage = 'list';
    }
    let progress: PlatformProgress = {
      stage,
      total: null,
      processed: 0,
      saved: 0,
      skipped: 0,
      failure: null,
    };
    /** 每次快照只写当前任务；正式职位保存与已入库计数由仓储共同提交。 */
    const report = (): void => {
      if (this.#generation !== null)
        this.repository.recordProgress(taskId, this.#generation, progress, this.now());
    };
    try {
      signal.throwIfAborted();
      // 1、连接总是新代次，旧游标不能用于另一个账号或重启后的进程。
      if (command.action === 'connect') {
        this.close();
        const generation = this.repository.reset(this.now());
        this.#generation = generation;
        report();
        const session = await this.provider.connect(command, signal);
        if (signal.aborted || this.repository.generation() !== generation) {
          session.disconnect();
          throw new PlatformError('session_unavailable');
        }
        this.#session = session;
        this.repository.setStatus(generation, 'connected', this.now());
        // 1.a、只响应当前会话的本地断线事件，不探活、不重连；订阅处理断线竞争。
        this.#unsubscribe = session.onDisconnected?.(() => {
          if (
            this.#session !== session ||
            this.#generation !== generation ||
            this.repository.generation() !== generation
          )
            return;
          this.#failed = true;
          this.#pending = null;
          this.repository.setStatus(generation, 'unavailable', this.now());
        });
        if (this.#failed) throw new PlatformError('session_unavailable');
        if (!acquire) return { generation, status: 'connected' };
        // 1.b、连接和获取属于同一显式任务；不依赖页面轮询追加 next。
        command = { action: 'next', generation };
        progress.stage = 'list';
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
      if (
        !this.#session ||
        this.#generation !== generation ||
        (this.#failed && command.action !== 'resume')
      )
        throw new PlatformError('session_unavailable');
      // 2、按动作处理批次或单条详情；批次串行补齐正文，失败时已提交职位不回滚。
      switch (command.action) {
        case 'next':
        case 'resume': {
          report();
          let result: PlatformBatch;
          switch (command.action) {
            case 'resume': {
              const pending = this.#pending;
              if (!pending || !this.#session.resume) throw new PlatformError('session_unavailable');
              // 2.a、先验证官网正常更新的上下文；通过前绝不再次请求原失败详情。
              await this.#session.resume(signal);
              signal.throwIfAborted();
              if (this.#pending !== pending || this.repository.generation() !== generation)
                throw new PlatformError('session_unavailable');
              if (this.now() >= pending.expiresAt)
                throw new PlatformError('session_unavailable', null, 'resume_expired');
              this.#failed = false;
              result = {
                candidates: pending.batch.candidates.slice(pending.saved),
                hasMore: pending.batch.hasMore,
              };
              // 2.a.i、只保留剩余候选并绑定本次任务；原期限不因恢复延长。
              this.#pending = {
                taskId,
                batch: result,
                saved: 0,
                expiresAt: pending.expiresAt,
                resumes: pending.resumes + 1,
              };
              break;
            }
            case 'next':
              result = await this.#session.readNext(signal);
              this.#pending = this.#session.resume
                ? { taskId, batch: result, saved: 0, expiresAt: this.now() + 600_000, resumes: 0 }
                : null;
              break;
          }
          signal.throwIfAborted();
          if (this.#connectionFailed() || this.repository.generation() !== generation)
            throw new PlatformError('session_unavailable');
          let savedCount = 0;
          progress = {
            ...progress,
            total: result.candidates.length,
            skipped: result.skippedMissingCompanyId ?? 0,
            ...(this.#pending ? { resumeCount: this.#pending.resumes } : {}),
          };
          report();
          for (const candidate of result.candidates) {
            // 2.a、网络前后复核取消和代次，旧会话不得继续请求或提交。
            signal.throwIfAborted();
            if (this.#connectionFailed() || this.repository.generation() !== generation)
              throw new PlatformError('session_unavailable');
            progress.stage = 'detail';
            // 2.a.i、外部请求前保存稳定身份，失败后可准确定位，不持久化私有访问参数。
            progress.currentExternalJobId = candidate.externalJobId;
            report();
            let detail: PlatformJobDetail;
            for (;;) {
              try {
                detail = await this.#session.readDetail(candidate.externalJobId, signal);
                break;
              } catch (error) {
                // 2.a.ii、仅详情 37 立即检查上下文；网络错误仍由连接器独立处理。
                const pending = this.#pending;
                if (
                  !(error instanceof PlatformError) ||
                  error.category !== 'access_blocked' ||
                  error.businessCode !== 37 ||
                  !pending ||
                  !this.#session.resume ||
                  signal.aborted ||
                  this.#connectionFailed() ||
                  this.repository.generation() !== generation ||
                  pending.resumes >= 5 ||
                  this.now() >= pending.expiresAt
                )
                  throw error;
                try {
                  progress.recovery = {
                    state: 'checking_context',
                    checks: progress.recovery?.checks ?? 0,
                  };
                  report();
                  await this.#session.resume(signal, {
                    waitForChange: true,
                    onContextCheck: (state) => {
                      // 2.a.iii、观察状态与恢复次数分开；换代后不能继续更新或发送请求。
                      signal.throwIfAborted();
                      if (
                        this.#connectionFailed() ||
                        this.#pending !== pending ||
                        this.repository.generation() !== generation
                      )
                        throw new PlatformError('session_unavailable');
                      progress.recovery = {
                        state: state === 'updated' ? 'resumed' : 'waiting_context',
                        checks: (progress.recovery?.checks ?? 0) + 1,
                      };
                      report();
                    },
                  });
                } catch (recoveryError) {
                  // 2.a.iv、保留原请求的脱敏摘要，恢复原因单独追加，不吞掉诊断现场。
                  if (
                    recoveryError instanceof PlatformError &&
                    recoveryError.reason === 'context_unchanged'
                  ) {
                    const blocked = new PlatformError('access_blocked', 37, 'context_unchanged');
                    blocked.message = `${error.message} [recovery=context_unchanged]`;
                    throw blocked;
                  }
                  if (recoveryError instanceof PlatformError)
                    recoveryError.message = `${error.message} [recovery=${platformFailure(recoveryError, false).reason ?? 'unknown'}]`;
                  throw recoveryError;
                }
                signal.throwIfAborted();
                if (
                  this.#connectionFailed() ||
                  this.#pending !== pending ||
                  this.repository.generation() !== generation
                )
                  throw new PlatformError('session_unavailable');
                if (this.now() >= pending.expiresAt)
                  throw new PlatformError('session_unavailable', null, 'resume_expired');
                // 2.a.v、自动和显式恢复共用预算；不重置期限、不重抓已提交详情。
                pending.resumes += 1;
                progress.resumeCount = pending.resumes;
                progress.recovery = { state: 'resumed', checks: progress.recovery.checks };
                report();
              }
            }
            signal.throwIfAborted();
            if (this.#connectionFailed() || this.repository.generation() !== generation)
              throw new PlatformError('session_unavailable');
            progress.stage = 'save';
            report();
            // 2.b、完整事实才入库；仓储短事务复核租约，不包裹任何网络请求。
            this.repository.save(detail, generation, taskId, this.now());
            savedCount += 1;
            progress.processed = savedCount;
            progress.saved = savedCount;
            delete progress.currentExternalJobId;
            if (this.#pending) this.#pending.saved = savedCount;
          }
          progress.stage = 'complete';
          report();
          this.repository.setStatus(generation, 'available', this.now());
          this.#pending = null;
          return {
            generation,
            status: 'available',
            hasMore: result.hasMore,
            savedCount,
            progress,
            candidates: [...result.candidates],
            skippedMissingCompanyId: result.skippedMissingCompanyId,
            ...(command.action === 'resume' ? { resumedFromTaskId: command.sourceTaskId } : {}),
          };
        }
        case 'detail': {
          progress.currentExternalJobId = command.externalJobId;
          report();
          const detail = await this.#session.readDetail(command.externalJobId, signal);
          signal.throwIfAborted();
          if (this.#connectionFailed() || this.repository.generation() !== generation)
            throw new PlatformError('session_unavailable');
          // 3、仓储在事务内校验任务仍持有租约且未取消，原子保存职位和观察。
          const jobId = this.repository.save(detail, generation, taskId, this.now());
          return { generation, status: 'saved', jobId };
        }
      }
    } catch (error) {
      // 3.a、选择页是无凭据的中间结果；用户确认之前不读 Cookie 或职位。
      if (
        error instanceof PlatformTargetSelectionRequired &&
        this.#generation !== null &&
        !signal.aborted
      ) {
        this.repository.setStatus(this.#generation, 'unavailable', this.now());
        return {
          generation: this.#generation,
          status: 'selection_required',
          targets: [...error.targets],
        };
      }
      // 4、仅批次详情 37 或未更新上下文保留待办；取消和其他错误不能恢复。
      if (
        signal.aborted ||
        this.repository.generation() !== this.#generation ||
        (this.#pending !== null && this.now() >= this.#pending.expiresAt) ||
        !(error instanceof PlatformError) ||
        !(
          ((command.action === 'next' || command.action === 'resume') &&
            progress.stage === 'detail' &&
            error.businessCode === 37 &&
            this.#pending !== null &&
            this.#pending.resumes < 5) ||
          (command.action === 'resume' && error.reason === 'context_unchanged')
        )
      )
        this.#pending = null;
      // 4、先冻结内存会话；即使进度写入遇到数据库异常，也不能继续采集。
      this.#failed = true;
      progress.failure = platformFailure(error, signal.aborted);
      report();
      // 4.a、按错误类别记录连接状态；保留同一 CDP 授权直至显式断开或退出。
      if (this.#generation !== null) {
        let status: 'access_blocked' | 'rate_limited' | 'unavailable';
        switch (error instanceof PlatformError ? error.category : null) {
          case 'access_blocked':
            status = 'access_blocked';
            break;
          case 'rate_limited':
            status = 'rate_limited';
            break;
          default:
            status = 'unavailable';
        }
        this.repository.setStatus(this.#generation, status, this.now());
      }
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
    manualRetryPayload: (payload) => {
      // 1、重试输入也在边界校验；只有 BOSS 日常获取明确授权重连。
      const command = bossCommandSchema.parse(payload);
      return command.action === 'acquire' && providerKey === 'boss'
        ? { ...command, reconnect: true }
        : command;
    },
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
