import { matchMetadataSql, enrichmentMetadataSql } from './metadata-sql.js';
import type Database from 'better-sqlite3';
import type {
  ResourceReferenceReader,
  ResourceReferenceSubject,
} from '@jobhunter/common/resource-references';

/** 匹配结果和职位理解的修订引用保护，不查询招聘侧修订表。 */
export class SqliteMatchingResourceReferenceReader implements ResourceReferenceReader {
  public constructor(private readonly client: Database.Database) {}

  /** 任何修订已参与理解或匹配时，禁止招聘侧物理清理。 */
  public isReferenced(subject: ResourceReferenceSubject): boolean {
    const ids = JSON.stringify(subject.versionIds);
    return Boolean(
      this.client
        .prepare(
          `SELECT EXISTS(SELECT 1 FROM ${matchMetadataSql} WHERE job_revision_id IN (SELECT value FROM json_each(?)) UNION ALL SELECT 1 FROM ${enrichmentMetadataSql} WHERE job_revision_id IN (SELECT value FROM json_each(?)))`,
        )
        .pluck()
        .get(ids, ids),
    );
  }
}
