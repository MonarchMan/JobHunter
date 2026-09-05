import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { sqliteMaintenanceSummarySchema, type TaskLogger } from '@jobhunter/application';
import { isSqliteMaintenanceActive, type SqliteDatabaseHandle } from '@jobhunter/db';

const executeFile = promisify(execFile);

/** 复用调度循环驱动维护子进程；分钟级轻量读门控，30 分钟实际检查。 */
export function createSqliteMaintenanceTick(
  database: SqliteDatabaseHandle,
  logger?: TaskLogger,
  signal?: AbortSignal,
): (lifecycleSignal?: AbortSignal) => Promise<void> {
  let nextPollAt = 0;
  return async (lifecycleSignal) => {
    const signals = [signal, lifecycleSignal].filter((value): value is AbortSignal => !!value);
    const combinedSignal = AbortSignal.any(signals);
    if (combinedSignal.aborted) return;
    // 1、进程内节流减少正常调度开销，持久化时间保证多进程与重启不补发历史检查。
    const now = Date.now();
    if (now < nextPollAt) return;
    nextPollAt = now + 60_000;
    if (isSqliteMaintenanceActive(database.client)) return;
    const state = database.client
      .prepare('SELECT next_check_at FROM database_maintenance WHERE id = 1')
      .get() as { readonly next_check_at: number };
    if (state.next_check_at > now) return;
    // 2、开发和生产均使用 workspace build 生成的入口；耗时操作不阻塞主 Worker。
    const entry = fileURLToPath(new URL('../dist/sqlite-maintenance-main.js', import.meta.url));
    const execution = executeFile(process.execPath, [entry, database.databasePath], {
      timeout: 5 * 60_000,
      killSignal: 'SIGKILL',
      maxBuffer: 64 * 1024,
      signal: combinedSignal,
    });
    // 3、AbortError 可能先于 close 事件到达；必须等子进程回收后才允许主库连接关闭。
    const closed = new Promise<void>((resolve) =>
      execution.child.once('close', () => {
        resolve();
      }),
    );
    let stdout: string;
    try {
      ({ stdout } = await execution);
    } finally {
      await closed;
    }
    // 3、子进程输出需经边界校验；日志只记录数值和固定原因，不含路径和正文。
    const summary = sqliteMaintenanceSummarySchema.nullable().parse(JSON.parse(stdout) as unknown);
    if (summary) logger?.info('database.maintenance', { ...summary });
  };
}
