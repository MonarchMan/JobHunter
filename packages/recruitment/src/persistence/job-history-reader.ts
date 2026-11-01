import type Database from 'better-sqlite3';
import { z } from 'zod';
import type { JobHistoryReader } from '../contracts/job-history.js';

/** 只读取招聘模块拥有的修订历史，兼容既有两种变更记录格式。 */
export class SqliteJobHistoryReader implements JobHistoryReader {
  public constructor(private readonly client: Database.Database) {}

  /** 按版本倒序返回安全修订投影，最新版本固定在第一项。 */
  public revisions(jobId: string): ReturnType<JobHistoryReader['revisions']> {
    // 1、在所有者边界校验行结构和历史变更数据。
    const rows = z
      .array(
        z.object({
          id: z.string(),
          revision_no: z.number(),
          change_set_json: z.string(),
          created_at: z.number(),
        }),
      )
      .parse(
        this.client
          .prepare(
            'SELECT id, revision_no, change_set_json, created_at FROM job_revisions WHERE job_id = ? ORDER BY revision_no DESC',
          )
          .all(jobId),
      );
    // 2、旧数组格式转为字段字典；保留已有字典格式，供展示侧组合。
    return rows.map((row) => {
      const changes = z
        .union([
          z.record(z.string(), z.unknown()),
          z.array(
            z.object({ field: z.string(), before: z.unknown(), after: z.unknown() }).strict(),
          ),
        ])
        .parse(JSON.parse(row.change_set_json) as unknown);
      return {
        id: row.id,
        revisionNumber: row.revision_no,
        createdAt: new Date(row.created_at).toISOString(),
        changes: Array.isArray(changes)
          ? Object.fromEntries(
              changes.map((change) => [
                change.field,
                { before: change.before, after: change.after },
              ]),
            )
          : changes,
      };
    });
  }
}
