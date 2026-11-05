import { matchMetadataSql, enrichmentMetadataSql, adviceMetadataSql } from './metadata-sql.js';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import type { ProfileDerivedDataManager } from '@jobhunter/user/contracts/profile-dependencies';

/** 匹配侧参与资料删除事务，只读写匹配结果、建议与理解表。 */
export class SqliteProfileDerivedDataManager implements ProfileDerivedDataManager {
  public constructor(private readonly client: Database.Database) {}

  /** 列出资料版本关联的匹配身份，供删除确认快照使用。 */
  public matchResultIds(ids: readonly string[]): readonly string[] {
    return z
      .array(z.string())
      .parse(
        this.client
          .prepare(
            `SELECT id FROM ${matchMetadataSql} WHERE profile_version_id IN (SELECT value FROM json_each(?)) ORDER BY id`,
          )
          .pluck()
          .all(JSON.stringify(ids)),
      );
  }

  /** 返回关联建议运行身份，不暴露建议正文。 */
  public adviceAgentRunIds(ids: readonly string[]): readonly string[] {
    return z
      .array(z.string())
      .parse(
        this.client
          .prepare(
            `SELECT DISTINCT agent_run_id FROM ${adviceMetadataSql} WHERE match_result_id IN (SELECT value FROM json_each(?)) ORDER BY agent_run_id`,
          )
          .pluck()
          .all(JSON.stringify(ids)),
      );
  }

  /** 在调用方已开启的同连接事务中清理过期版本派生结果。 */
  public deleteMatchesForVersions(ids: readonly string[]): void {
    // 1、由匹配所有者删除派生结果；建议沿用现有外键级联语义。
    this.client
      .prepare(
        `DELETE FROM job_metadata WHERE name='match_result' AND json_extract(value,'$.profile_version_id') IN (SELECT value FROM json_each(?))`,
      )
      .run(JSON.stringify(ids));
  }

  /** 清理已经确认的匹配身份，不扩大删除范围。 */
  public deleteMatchResults(ids: readonly string[]): void {
    this.client
      .prepare(
        `DELETE FROM job_metadata WHERE name='match_result' AND id IN (SELECT value FROM json_each(?))`,
      )
      .run(JSON.stringify(ids));
  }

  /** 理解或建议仍使用该运行时，禁止回收通用运行记录。 */
  public hasAgentRunReferences(id: string): boolean {
    return Boolean(
      this.client
        .prepare(
          `SELECT EXISTS(SELECT 1 FROM ${enrichmentMetadataSql} WHERE agent_run_id=? UNION ALL SELECT 1 FROM ${adviceMetadataSql} WHERE agent_run_id=?)`,
        )
        .pluck()
        .get(id, id),
    );
  }
}
