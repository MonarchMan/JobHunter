import type Database from 'better-sqlite3';

/** 维护错误使用固定标识供 Web 统一转为 503，不暴露驱动详情。 */
export const sqliteMaintenanceMessage = 'JOBHUNTER_DATABASE_MAINTENANCE';

/** 检查本机持锁进程是否存活；无权限访问时保守视为存活。 */
export function maintenanceProcessAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(error instanceof Error && 'code' in error && error.code === 'ESRCH');
  }
}

/** 读取维护互斥状态；调用方在写事务内检查可避免领取竞态。 */
export function isSqliteMaintenanceActive(client: Database.Database): boolean {
  // 1、旧迁移测试/升级前数据库尚无状态表，保持原行为。
  if (!client.prepare("SELECT 1 FROM sqlite_master WHERE name = 'database_maintenance'").get())
    return false;
  const row = client.prepare('SELECT owner_pid FROM database_maintenance WHERE id = 1').get() as {
    readonly owner_pid: number | null;
  };
  return row.owner_pid !== null && maintenanceProcessAlive(row.owner_pid);
}

/** 在标准连接保护所有普通表写入；专用维护连接不安装此连接级保护。 */
export function installSqliteMaintenanceGate(client: Database.Database): void {
  if (!client.prepare("SELECT 1 FROM sqlite_master WHERE name = 'database_maintenance'").get())
    return;
  // 1、函数只判断进程，不递归访问数据库；不设 deterministic，避免缓存存活结果。
  client.function('jobhunter_process_alive', (pid: unknown) =>
    typeof pid === 'number' && maintenanceProcessAlive(pid) ? 1 : 0,
  );
  const tables = client
    .prepare(
      "SELECT name FROM pragma_table_list WHERE schema = 'main' AND type = 'table' AND name NOT LIKE 'sqlite_%' AND name != 'database_maintenance'",
    )
    .all() as { readonly name: string }[];
  // 2、BEFORE 触发器在 SQLite 写事务内拒绝新写入，正在执行的写事务先于维护标记提交。
  for (const { name } of tables) {
    const quoted = '"' + name.replaceAll('"', '""') + '"';
    for (const operation of ['INSERT', 'UPDATE', 'DELETE']) {
      const trigger = '"' + ('maintenance_' + name + '_' + operation).replaceAll('"', '""') + '"';
      client.exec(`CREATE TEMP TRIGGER IF NOT EXISTS ${trigger} BEFORE ${operation} ON main.${quoted}
        WHEN EXISTS(SELECT 1 FROM database_maintenance WHERE id = 1
          AND owner_pid IS NOT NULL AND jobhunter_process_alive(owner_pid) = 1)
        BEGIN SELECT RAISE(ABORT, 'JOBHUNTER_DATABASE_MAINTENANCE'); END`);
    }
  }
}

/** 沿错误原因链识别维护拒写，适配基础设施包装异常。 */
export function isSqliteMaintenanceError(error: unknown): boolean {
  const seen = new Set<unknown>();
  while (error instanceof Error && !seen.has(error)) {
    if (error.message === sqliteMaintenanceMessage) return true;
    seen.add(error);
    error = error.cause;
  }
  return false;
}
