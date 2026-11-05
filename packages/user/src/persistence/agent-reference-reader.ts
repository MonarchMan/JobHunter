import type Database from 'better-sqlite3';
import type { AgentReferenceReader } from '@jobhunter/common/operations/cleanup-service';

/** 用户侧运行引用保护，不需要加载画像或面试正文。 */
export class SqliteUserAgentReferenceReader implements AgentReferenceReader {
  public constructor(private readonly client: Database.Database) {}

  /** 画像、面试提问或摘要仍有引用时，运行记录必须保留。 */
  public hasAgentRunReferences(id: string): boolean {
    return Boolean(
      this.client
        .prepare(
          'SELECT EXISTS(SELECT 1 FROM profile_versions WHERE agent_run_id=? UNION ALL SELECT 1 FROM model_requests WHERE agent_run_id=? AND ai_message_id IS NOT NULL)',
        )
        .pluck()
        .get(id, id),
    );
  }
}
