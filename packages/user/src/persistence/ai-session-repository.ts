import type Database from 'better-sqlite3';
import type { AiMessage, AiSession, AiSessionRepository } from '../ports/ai-sessions.js';

const sessionColumns = 'id,type,title,created_at AS createdAt,updated_at AS updatedAt';
const messageColumns = `id,session_id AS sessionId,role,content,sequence,
  CASE WHEN status='pending' THEN COALESCE((SELECT CASE WHEN task.status IN ('failed','cancelled') THEN task.status ELSE 'pending' END
    FROM tasks task WHERE task.task_type='ai.reply' AND json_extract(task.private_state,'$.messageId')=ai_messages.id),status) ELSE status END AS status,
  created_at AS createdAt,updated_at AS updatedAt`;

/** 持久化通用会话及消息；所有序号分配与入队由同一个短事务保护。 */
export class SqliteAiSessionRepository implements AiSessionRepository {
  public constructor(private readonly db: Database.Database) {}
  /** 将消息变更与任务发布放入同一立即事务，阻止并发请求分配重复序号。 */
  public transaction<T>(operation: () => T): T {
    return this.db.transaction(operation).immediate();
  }
  /** 按最近活动排序，包含历史会话，不过滤完成状态。 */
  public list(): readonly AiSession[] {
    return this.db
      .prepare(`SELECT ${sessionColumns} FROM ai_sessions ORDER BY updated_at DESC,id`)
      .all() as AiSession[];
  }
  /** 读取指定会话；删除后返回空，不重新创建隐式会话。 */
  public get(id: string): AiSession | null {
    return (
      (this.db.prepare(`SELECT ${sessionColumns} FROM ai_sessions WHERE id=?`).get(id) as
        AiSession | undefined) ?? null
    );
  }
  /** 保存会话及经应用层校验的可选业务关联。 */
  public create(session: AiSession, metadata: Readonly<Record<string, string>>): void {
    this.db
      .prepare('INSERT INTO ai_sessions(id,type,title,created_at,updated_at) VALUES(?,?,?,?,?)')
      .run(session.id, session.type, session.title, session.createdAt, session.updatedAt);
    for (const [name, value] of Object.entries(metadata))
      this.db
        .prepare(
          'INSERT INTO ai_session_metadata(id,session_id,name,value,created_at,updated_at) VALUES(?,?,?,?,?,?)',
        )
        .run(
          `${session.id}:${name}`,
          session.id,
          name,
          value,
          session.createdAt,
          session.updatedAt,
        );
  }
  /** 返回可选关联，不加载项目文件或扩展上下文。 */
  public metadata(sessionId: string): Readonly<Record<string, string>> {
    return Object.fromEntries(
      (
        this.db
          .prepare('SELECT name,value FROM ai_session_metadata WHERE session_id=?')
          .all(sessionId) as { name: string; value: string }[]
      ).map((row) => [row.name, row.value]),
    );
  }
  /** 按稳定序号读取当前消息；执行器崩溃后的任务终态覆盖挂起显示。 */
  public messages(sessionId: string): readonly AiMessage[] {
    return this.db
      .prepare(`SELECT ${messageColumns} FROM ai_messages WHERE session_id=? ORDER BY sequence`)
      .all(sessionId) as AiMessage[];
  }
  /** 使用执行输入的索引投影定位任务，手动重试更换令牌也不丢失关联。 */
  public taskId(messageId: string): string | null {
    return (
      (this.db
        .prepare(
          "SELECT id FROM tasks WHERE task_type='ai.reply' AND json_extract(private_state,'$.messageId')=?",
        )
        .pluck()
        .get(messageId) as string | undefined) ?? null
    );
  }
  /** 追加消息并推进会话更新时间，调用方必须持有事务。 */
  public insert(message: AiMessage): void {
    this.db
      .prepare(
        'INSERT INTO ai_messages(id,session_id,role,content,sequence,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',
      )
      .run(
        message.id,
        message.sessionId,
        message.role,
        message.content,
        message.sequence,
        message.status,
        message.createdAt,
        message.updatedAt,
      );
    this.db
      .prepare('UPDATE ai_sessions SET updated_at=MAX(updated_at+1,?) WHERE id=?')
      .run(message.updatedAt, message.sessionId);
  }
  /** 乐观更新用户内容，取消未完成回复，不复制旧回答。 */
  public edit(id: string, content: string, expectedUpdatedAt: number, now: number): boolean {
    const result = this.db
      .prepare(
        "UPDATE ai_messages SET content=?,updated_at=MAX(updated_at+1,?) WHERE id=? AND role='user' AND updated_at=?",
      )
      .run(content, now, id, expectedUpdatedAt);
    if (!result.changes) return false;
    this.db
      .prepare(
        "UPDATE ai_messages SET status='cancelled',updated_at=MAX(updated_at+1,?) WHERE session_id=(SELECT session_id FROM ai_messages WHERE id=?) AND status IN ('pending','failed')",
      )
      .run(now, id);
    this.db
      .prepare(
        'UPDATE ai_sessions SET updated_at=MAX(updated_at+1,?) WHERE id=(SELECT session_id FROM ai_messages WHERE id=?)',
      )
      .run(now, id);
    return true;
  }
  /** 只提交尚未完成的助手回复，已取消或完成的消息不可被迟到结果覆盖。 */
  public finish(id: string, status: AiMessage['status'], content: string, now: number): boolean {
    return (
      this.db
        .prepare(
          "UPDATE ai_messages SET status=?,content=?,updated_at=MAX(updated_at+1,?) WHERE id=? AND role='assistant' AND status IN ('pending','failed')",
        )
        .run(status, content, now, id).changes > 0
    );
  }
  /** 删除会话及其消息，外键解除模型请求关联而保留账本。 */
  public delete(id: string): void {
    this.db.prepare('DELETE FROM ai_sessions WHERE id=?').run(id);
  }
}
