import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { sqliteMaintenanceSummarySchema, type TaskLogger } from '@jobhunter/application';
import { isSqliteMaintenanceActive, type SqliteDatabaseHandle } from '@jobhunter/db';

const executeFile = promisify(execFile);

/** 描述 SQLite 维护子进程在当前源码或构建运行模式下需要的 Node 参数。 */
export interface SqliteMaintenanceCommand {
  readonly arguments: readonly string[];
}

/** 源码模式通过 tsx 执行 TypeScript 入口，构建模式执行同目录 JavaScript 入口。 */
export function resolveSqliteMaintenanceCommand(
  moduleUrl = import.meta.url,
): SqliteMaintenanceCommand {
  const modulePath = fileURLToPath(moduleUrl);
  if (path.extname(modulePath) === '.ts') {
    const require = createRequire(moduleUrl);
    const tsxBin = path.join(path.dirname(require.resolve('tsx')), 'cli.mjs');
    return {
      arguments: [tsxBin, fileURLToPath(new URL('./sqlite-maintenance-main.ts', moduleUrl))],
    };
  }
  return {
    arguments: [fileURLToPath(new URL('./sqlite-maintenance-main.js', moduleUrl))],
  };
}

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
    // 2、源码模式执行 TypeScript 入口，生产执行构建入口；耗时操作不阻塞主 Worker。
    const command = resolveSqliteMaintenanceCommand();
    const execution = executeFile(process.execPath, [...command.arguments, database.databasePath], {
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
    // 4、子进程输出需经边界校验；日志只记录数值和固定原因，不含路径和正文。
    const summary = sqliteMaintenanceSummarySchema.nullable().parse(JSON.parse(stdout) as unknown);
    if (summary) logger?.info('database.maintenance', { ...summary });
  };
}
