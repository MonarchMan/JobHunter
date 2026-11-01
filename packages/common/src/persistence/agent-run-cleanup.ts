import type Database from 'better-sqlite3';

/** 通用运行记录的事务清理参与者，引用保护由业务所有者提供。 */
export class SqliteAgentRunCleanup {
  public constructor(private readonly client: Database.Database) {}

  /** 只在各业务所有者已确认无引用后执行回收。 */
  public prune(agentRunId: string, referenced: boolean): void {
    // 1、任一业务所有者仍有引用时保留运行记录；否则沿用原来的运行审计清理语义。
    if (referenced) return;
    this.client.prepare('DELETE FROM agent_runs WHERE id=?').run(agentRunId);
    // 2、仅删除已不存在运行记录的对应事件，避免误清理共享运行审计。
    this.client
      .prepare(
        "DELETE FROM events WHERE stream_type='agent_run' AND stream_id=? AND NOT EXISTS(SELECT 1 FROM agent_runs WHERE id=?)",
      )
      .run(agentRunId, agentRunId);
  }
}
