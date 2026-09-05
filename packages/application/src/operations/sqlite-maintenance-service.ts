import { z } from 'zod';

/** 维护检查指标，仅包含数据库空间与 checkpoint 数值。 */
export const sqliteSpaceSchema = z.object({
  databaseBytes: z.number().nonnegative(),
  walBytes: z.number().nonnegative(),
  freeBytes: z.number().nonnegative(),
  freeRatio: z.number().min(0).max(1),
});
export type SqliteSpace = z.infer<typeof sqliteSpaceSchema>;

/** 单例检查摘要；无需为无操作检查创建任务。 */
export const sqliteMaintenanceSummarySchema = z.object({
  checkedAt: z.number(),
  outcome: z.enum(['healthy', 'skipped', 'succeeded', 'failed']),
  reason: z.string(),
  before: sqliteSpaceSchema,
  after: sqliteSpaceSchema,
  durationMs: z.number().nonnegative(),
  reclaimedBytes: z.number(),
});
export type SqliteMaintenanceSummary = z.infer<typeof sqliteMaintenanceSummarySchema>;

/** 持久化时钟避免进程重启或休眠恢复后重复补发检查。 */
export interface SqliteMaintenanceState {
  readonly lastDailyAt: number | null;
  readonly lastVacuumAt: number | null;
  readonly vacuumPending: boolean;
}

/** 基础设施端口；实现负责跨进程原子检查、写保护与备份校验。 */
export interface SqliteMaintenanceRepository {
  beginCheck(now: number, nextCheckAt: number): SqliteMaintenanceState | null;
  inspect(): SqliteSpace;
  passiveCheckpoint(): void;
  optimize(): boolean;
  maintain(action: 'vacuum' | 'truncate', now: number): Promise<string>;
  finishCheck(input: {
    readonly summary: SqliteMaintenanceSummary;
    readonly lastDailyAt: number | null;
    readonly lastVacuumAt: number | null;
    readonly vacuumPending: boolean;
  }): void;
}

/** 当前个人版默认维护参数；仅测试通过构造参数缩小阈值。 */
export const sqliteMaintenancePolicy = {
  checkIntervalMs: 30 * 60_000,
  dailyIntervalMs: 24 * 60 * 60_000,
  vacuumCooldownMs: 7 * 24 * 60 * 60_000,
  walThresholdBytes: 64 * 1024 * 1024,
  freeThresholdBytes: 64 * 1024 * 1024,
  freeRatio: 0.25,
} as const;

/** 依照阈值与冷却期编排检查，不涉及 SQLite 驱动或文件系统。 */
export class SqliteMaintenanceService {
  public constructor(
    private readonly repository: SqliteMaintenanceRepository,
    private readonly now: () => number = Date.now,
    private readonly policy: {
      readonly [K in keyof typeof sqliteMaintenancePolicy]: number;
    } = sqliteMaintenancePolicy,
  ) {}

  /** 一次到期检查最多执行一次整理；忙碌留待下个周期，失败保留安全原因。 */
  public async check(): Promise<SqliteMaintenanceSummary | null> {
    // 1、原子占用本次检查时刻，其他进程及重启补查不会重复执行。
    const started = this.now();
    const state = this.repository.beginCheck(started, started + this.policy.checkIntervalMs);
    if (!state) return null;
    const before = this.repository.inspect();
    let lastDailyAt = state.lastDailyAt;
    let lastVacuumAt = state.lastVacuumAt;
    let pending = state.vacuumPending;
    let outcome: SqliteMaintenanceSummary['outcome'] = 'healthy';
    let reason = 'below_threshold';
    try {
      // 2、日检和大量删除后的补查评估主库；WAL 达阈值先做不等待读者的 checkpoint。
      const daily = lastDailyAt === null || started - lastDailyAt >= this.policy.dailyIntervalMs;
      if (daily || pending) {
        pending =
          before.freeBytes >= this.policy.freeThresholdBytes &&
          before.freeRatio >= this.policy.freeRatio;
      }
      if (daily) {
        if (this.repository.optimize()) lastDailyAt = started;
        else {
          outcome = 'skipped';
          reason = 'optimize_busy';
        }
      }
      if (before.walBytes >= this.policy.walThresholdBytes) this.repository.passiveCheckpoint();
      const space = this.repository.inspect();
      // 3、满足冷却期才整理；维护仓储再次在写事务内检查空闲，关闭跨进程竞态。
      const cooldown =
        lastVacuumAt === null || started - lastVacuumAt >= this.policy.vacuumCooldownMs;
      const action =
        pending && cooldown
          ? 'vacuum'
          : space.walBytes >= this.policy.walThresholdBytes
            ? 'truncate'
            : null;
      if (action) {
        reason = await this.repository.maintain(action, started);
        outcome = reason === 'succeeded' ? 'succeeded' : 'skipped';
        if (action === 'vacuum' && outcome === 'succeeded') {
          lastVacuumAt = this.now();
          pending = false;
        }
      } else if (pending) {
        outcome = 'skipped';
        reason = 'vacuum_cooldown';
      }
    } catch {
      // 4、外部错误不携带原始路径或正文；详细过程由维护任务审计记录。
      outcome = 'failed';
      reason = 'maintenance_failed';
    }
    const after = this.repository.inspect();
    const summary = sqliteMaintenanceSummarySchema.parse({
      checkedAt: started,
      outcome,
      reason,
      before,
      after,
      durationMs: Math.max(0, this.now() - started),
      reclaimedBytes: before.databaseBytes + before.walBytes - after.databaseBytes - after.walBytes,
    });
    this.repository.finishCheck({ summary, lastDailyAt, lastVacuumAt, vacuumPending: pending });
    return summary;
  }
}
