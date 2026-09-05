import Database from 'better-sqlite3';
import { chmod, mkdir, readdir, statfs, unlink, writeFile } from 'node:fs/promises';
import { statSync } from 'node:fs';
import path from 'node:path';
import {
  sqliteMaintenanceSummarySchema,
  type SqliteMaintenanceRepository as MaintenancePort,
  type SqliteMaintenanceState,
  type SqliteSpace,
} from '@jobhunter/application';
import { SystemIdGenerator } from '@jobhunter/domain';
import { isSqliteMaintenanceActive } from './maintenance-gate.js';

/** 将 SQLite 文件大小读为 0（WAL 尚未创建时），其他错误保留供维护失败诊断。 */
function fileBytes(file: string): number {
  try {
    return statSync(file).size;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return 0;
    throw error;
  }
}

/** 维护连接绕过业务写保护，仅在取得数据库维护标记后执行重操作。 */
export class SqliteMaintenanceRepository implements MaintenancePort {
  readonly #client: Database.Database;
  readonly #databasePath: string;
  readonly #backupRoot: string;

  public constructor(databasePath: string) {
    this.#databasePath = path.resolve(databasePath);
    this.#backupRoot = path.join(path.dirname(this.#databasePath), 'backups', 'sqlite-maintenance');
    this.#client = new Database(this.#databasePath, { fileMustExist: true, timeout: 250 });
    this.#client.pragma('foreign_keys = ON');
  }

  /** 关闭专用连接，调用方在子进程 finally 中执行。 */
  public close(): void {
    this.#client.close();
  }

  /** 原子推进检查时间；进程中断后只补记旧维护任务，不重复执行历史周期。 */
  public beginCheck(now: number, nextCheckAt: number): SqliteMaintenanceState | null {
    return this.#client
      .transaction(() => {
        // 1、维护进程仍存活时只等待；死亡持有者留下的任务标记为中断。
        if (isSqliteMaintenanceActive(this.#client)) return null;
        const row = this.#client
          .prepare('SELECT * FROM database_maintenance WHERE id = 1')
          .get() as {
          readonly next_check_at: number;
          readonly last_daily_at: number | null;
          readonly last_vacuum_at: number | null;
          readonly vacuum_pending: number;
          readonly owner_pid: number | null;
          readonly task_id: string | null;
        };
        if (row.owner_pid !== null) {
          this.#client
            .prepare(
              `UPDATE tasks SET status = 'failed', finished_at = ?,
          lease_owner = NULL, lease_expires_at = NULL, error_category = 'permanent',
          error_summary = '数据库维护进程中断；下次检查将重新评估。'
          WHERE id = ? AND status = 'running'`,
            )
            .run(now, row.task_id);
          this.#client
            .prepare(
              'UPDATE database_maintenance SET owner_pid = NULL, task_id = NULL WHERE id = 1',
            )
            .run();
        }
        // 2、到期只占用当前一次，避免恢复后追赶执行；调度写入与维护标记共用 SQLite 写锁。
        if (row.next_check_at > now) return null;
        this.#client
          .prepare('UPDATE database_maintenance SET next_check_at = ? WHERE id = 1')
          .run(nextCheckAt);
        return {
          lastDailyAt: row.last_daily_at,
          lastVacuumAt: row.last_vacuum_at,
          vacuumPending: row.vacuum_pending === 1,
        };
      })
      .immediate();
  }

  /** 读取页级空间指标，不扫描职位或任务正文。 */
  public inspect(): SqliteSpace {
    const pages = this.#client.pragma('page_count', { simple: true }) as number;
    const free = this.#client.pragma('freelist_count', { simple: true }) as number;
    const pageSize = this.#client.pragma('page_size', { simple: true }) as number;
    return {
      databaseBytes: fileBytes(this.#databasePath),
      walBytes: fileBytes(this.#databasePath + '-wal'),
      freeBytes: free * pageSize,
      freeRatio: pages === 0 ? 0 : free / pages,
    };
  }

  /** 不等待其他读写连接；未完成的页留到空闲阶段。 */
  public passiveCheckpoint(): void {
    this.#client.pragma('wal_checkpoint(PASSIVE)');
  }

  /** 每日维护查询统计信息，使用 SQLite 自身的有限分析策略。 */
  public optimize(): boolean {
    try {
      this.#client.pragma('optimize = 0x10002');
      return true;
    } catch (error) {
      // 1、统计更新遇写锁时留到下周期，不算维护失败，也不推进每日检查时钟。
      if (
        error instanceof Error &&
        'code' in error &&
        (error.code === 'SQLITE_BUSY' || error.code === 'SQLITE_LOCKED')
      )
        return false;
      throw error;
    }
  }

  /** 检查短暂空闲并建立写保护；失败不生成任务，后续周期再检查。 */
  #acquire(taskId: string, now: number): boolean {
    return this.#client
      .transaction(() => {
        // 1、BEGIN IMMEDIATE 等待既有写事务结束，再同时检查活动任务和即将到期调度。
        if (isSqliteMaintenanceActive(this.#client)) return false;
        if (
          this.#client
            .prepare(
              `SELECT 1 FROM tasks WHERE status = 'running'
        OR (status = 'pending' AND available_at <= ?) LIMIT 1`,
            )
            .get(now)
        )
          return false;
        if (
          this.#client
            .prepare('SELECT 1 FROM schedules WHERE enabled = 1 AND next_run_at <= ? LIMIT 1')
            .get(now + 60_000)
        )
          return false;
        // 2、实际尝试整理才创建任务；随后提交标记，标准连接中的触发器将拒绝新写入。
        this.#client
          .prepare(
            `INSERT INTO tasks
        (id, task_type, payload_json, status, idempotency_key, attempt_count, max_attempts,
         available_at, created_at, started_at, lease_owner, lease_expires_at)
        VALUES (?, 'maintenance.sqlite', '{}', 'running', ?, 1, 1, ?, ?, ?, ?, ?)`,
          )
          .run(
            taskId,
            'maintenance.sqlite:' + taskId,
            now,
            now,
            now,
            'sqlite-maintenance-' + String(process.pid),
            now + 6 * 60_000,
          );
        this.#client
          .prepare('UPDATE database_maintenance SET owner_pid = ?, task_id = ? WHERE id = 1')
          .run(process.pid, taskId);
        return true;
      })
      .immediate();
  }

  /** 短等待读者释放 WAL；繁忙时不循环强制截断。 */
  #truncate(): boolean {
    const result = this.#client.pragma('wal_checkpoint(TRUNCATE)') as { readonly busy: number }[];
    return result[0]?.busy === 0;
  }

  /** 校验备份或整理后的主库，校验失败不清理旧备份。 */
  #verify(client: Database.Database): void {
    if (
      client.pragma('integrity_check', { simple: true }) !== 'ok' ||
      (client.pragma('foreign_key_check') as readonly unknown[]).length !== 0
    )
      throw new Error('integrity_failed');
  }

  /** 仅清理本组件目录中已有校验标记的旧备份，手工文件和未完成备份不触碰。 */
  async #retainBackups(): Promise<void> {
    const entries = await readdir(this.#backupRoot, { withFileTypes: true });
    const verified = entries
      .filter(
        (entry) => entry.isFile() && /^auto-[0-9a-f-]{36}\.sqlite\.verified$/.test(entry.name),
      )
      .map((entry) => entry.name)
      .sort()
      .reverse();
    for (const marker of verified.slice(2)) {
      // 1、限定明确的组件文件名，不递归删除目录；标记最后删除。
      const file = path.join(this.#backupRoot, marker.slice(0, -'.verified'.length));
      await unlink(file).catch((error: unknown) => {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      });
      await unlink(path.join(this.#backupRoot, marker));
    }
  }

  /** 执行一次维护并保证释放标记；不将备份自动恢复覆盖当前数据库。 */
  public async maintain(action: 'vacuum' | 'truncate', now: number): Promise<string> {
    const id = new SystemIdGenerator().generate();
    const before = this.inspect();
    let acquired = false;
    let result = 'busy';
    let stage = 'acquire';
    try {
      // 1、空间不足直接跳过，预留一份备份、两倍数据库临时空间及 64 MiB 余量。
      if (action === 'vacuum') {
        const fs = await statfs(path.dirname(this.#databasePath));
        // 1.a、WAL 尚未 checkpoint 时主文件可能很小，按逻辑页数预留完整数据库空间。
        const logicalBytes =
          (this.#client.pragma('page_count', { simple: true }) as number) *
          (this.#client.pragma('page_size', { simple: true }) as number);
        if (
          fs.bavail * fs.bsize <
          Math.max(before.databaseBytes, logicalBytes) * 3 + 64 * 1024 * 1024
        )
          return 'insufficient_disk';
      }
      acquired = this.#acquire(id, now);
      if (!acquired) return 'work_pending';
      stage = 'checkpoint';
      if (!this.#truncate()) {
        result = 'checkpoint_busy';
        return result;
      }
      if (action === 'vacuum') {
        // 2、在事务外备份并校验；只有成功整理才授予保留轮换资格。
        stage = 'backup';
        await mkdir(this.#backupRoot, { recursive: true });
        const backup = path.join(this.#backupRoot, 'auto-' + id + '.sqlite');
        await this.#client.backup(backup);
        await chmod(backup, 0o600);
        const snapshot = new Database(backup, { readonly: true });
        try {
          this.#verify(snapshot);
        } finally {
          snapshot.close();
        }
        stage = 'vacuum';
        this.#client.exec('VACUUM');
        stage = 'verify';
        this.#verify(this.#client);
        // 3、后置 checkpoint 若遇读者不影响已完成的空间整理，下周期继续检查 WAL。
        this.#truncate();
        await writeFile(backup + '.verified', String(Date.now()), { flag: 'wx', mode: 0o600 });
        stage = 'retention';
        await this.#retainBackups();
      }
      result = 'succeeded';
      return result;
    } catch (error) {
      const busy =
        error instanceof Error &&
        'code' in error &&
        (error.code === 'SQLITE_BUSY' || error.code === 'SQLITE_LOCKED');
      result = busy ? 'busy' : 'failed:' + stage;
      if (!busy) throw new Error(result, { cause: error });
      return result;
    } finally {
      if (acquired) {
        // 4、先恢复正常写入，再将本次安全指标写入单条维护任务。
        this.#client
          .transaction(() => {
            this.#client
              .prepare(
                'UPDATE database_maintenance SET owner_pid = NULL, task_id = NULL WHERE id = 1 AND owner_pid = ?',
              )
              .run(process.pid);
            this.#client
              .prepare(
                `UPDATE tasks SET status = ?, finished_at = ?, lease_owner = NULL,
            lease_expires_at = NULL, error_category = ?, error_summary = ?, result_json = ?
            WHERE id = ?`,
              )
              .run(
                result.startsWith('failed:') ? 'failed' : 'succeeded',
                Date.now(),
                result.startsWith('failed:') ? 'permanent' : null,
                result.startsWith('failed:') ? '数据库维护失败：' + stage : null,
                JSON.stringify({ action, outcome: result, before, after: this.inspect() }),
                id,
              );
          })
          .immediate();
      }
    }
  }

  /** 只更新单例摘要；成功 VACUUM 的冷却时间持久化，跨重启生效。 */
  public finishCheck(input: Parameters<MaintenancePort['finishCheck']>[0]): void {
    const summary = sqliteMaintenanceSummarySchema.parse(input.summary);
    this.#client
      .prepare(
        `UPDATE database_maintenance SET summary_json = ?, last_daily_at = ?,
      last_vacuum_at = ?, vacuum_pending = ? WHERE id = 1`,
      )
      .run(
        JSON.stringify(summary),
        input.lastDailyAt,
        input.lastVacuumAt,
        input.vacuumPending ? 1 : 0,
      );
  }
}
