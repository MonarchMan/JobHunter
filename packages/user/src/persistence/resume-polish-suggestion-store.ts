import type Database from 'better-sqlite3';
import type { ResumePolishSuggestionStore } from '../ports/resume-polish.js';
/** 保存用户可选择应用的润色结果，画像删除时随业务关系清理。 */
export class SqliteResumePolishSuggestionStore implements ResumePolishSuggestionStore {
  public constructor(private readonly client: Database.Database) {}
  /** 保存已通过业务校验的建议，供页面查看与选择应用。 */
  public save(
    id: string,
    profileVersionId: string,
    result: Parameters<ResumePolishSuggestionStore['save']>[2],
  ): void {
    this.client
      .prepare(
        'INSERT INTO resume_polish_suggestions(id,profile_version_id,result_json) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET result_json=excluded.result_json',
      )
      .run(id, profileVersionId, JSON.stringify(result));
  }
  /** 读取指定建议；输出结构由调用边界再次校验。 */
  public get(id: string): unknown {
    const value = this.client
      .prepare('SELECT result_json FROM resume_polish_suggestions WHERE id=?')
      .pluck()
      .get(id) as string | undefined;
    return value === undefined ? null : (JSON.parse(value) as unknown);
  }
}
