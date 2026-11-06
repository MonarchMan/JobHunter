import type Database from 'better-sqlite3';
import { currentTaskExecution } from '../tasks/contracts/execution-scope.js';

/** 任务提交被拒绝时使用固定错误，不泄露业务内容和分派凭证。 */
export const taskExecutionLostMessage = 'JOBHUNTER_TASK_EXECUTION_LOST';

/** 在实际写事务内核验异步调用链的分派身份，保护所有业务表而非仅 tasks。 */
export function installTaskExecutionGate(client: Database.Database): void {
  // 1、迁移前的旧库可能没有任务表；标准连接在迁移完成后安装保护。
  if (!client.prepare("SELECT 1 FROM sqlite_master WHERE name = 'tasks'").get()) return;
  client.function('task_execution_id', () => currentTaskExecution()?.taskId ?? null);
  client.function('task_execution_owner', () => currentTaskExecution()?.owner ?? null);
  client.function('task_execution_attempt', () => currentTaskExecution()?.attempt ?? null);
  client.function('task_execution_now', () => currentTaskExecution()?.now() ?? 0);
  const tables = client
    .prepare(
      "SELECT name FROM pragma_table_list WHERE schema = 'main' AND type = 'table' AND name NOT LIKE 'sqlite_%'",
    )
    .all() as { readonly name: string }[];
  // 2、TEMP 触发器是连接级提交保护，不调度任务，也不改变持久数据库结构。
  // 查询发生在原业务写事务内，避免先检查后提交时被新的执行者接管。
  for (const { name } of tables) {
    const quoted = '"' + name.replaceAll('"', '""') + '"';
    for (const operation of ['INSERT', 'UPDATE', 'DELETE']) {
      const trigger = '"' + `execution_${name}_${operation}`.replaceAll('"', '""') + '"';
      client.exec(`CREATE TEMP TRIGGER IF NOT EXISTS ${trigger} BEFORE ${operation} ON main.${quoted}
        WHEN task_execution_id() IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM main.tasks WHERE id = task_execution_id()
            AND status = 'running' AND lease_owner = task_execution_owner()
            AND attempt_count = task_execution_attempt()
            AND lease_expires_at > task_execution_now() AND cancel_requested_at IS NULL
        )
        BEGIN SELECT RAISE(ABORT, 'JOBHUNTER_TASK_EXECUTION_LOST'); END`);
    }
  }
}
