import type Database from 'better-sqlite3';
import type {
  ResourceReferenceReader,
  ResourceReferenceSubject,
} from '@jobhunter/common/resource-references';

/** 用户文件、项目和练习绑定的引用保护，由用户所有者执行。 */
export class SqliteUserResourceReferenceReader implements ResourceReferenceReader {
  public constructor(private readonly client: Database.Database) {}

  /** 检查文件与训练绑定；未知 JSON 字段命中身份也保守保护。 */
  public isReferenced(subject: ResourceReferenceSubject): boolean {
    const ids = JSON.stringify([subject.id, ...subject.aliases, ...subject.versionIds]);
    // 1、保留旧有任意 JSON 值引用保护，不推测未识别业务字段可被丢弃。
    return Boolean(
      this.client
        .prepare(
          `SELECT EXISTS(SELECT 1 FROM files f,json_tree(f.properties_json) v WHERE CAST(v.atom AS TEXT) IN (SELECT value FROM json_each(?)) UNION ALL SELECT 1 FROM file_entity_mappings f,json_tree(f.metadata_json) v WHERE CAST(v.atom AS TEXT) IN (SELECT value FROM json_each(?)) UNION ALL SELECT 1 FROM resume_project_snapshots p,json_tree(p.project_json) v WHERE CAST(v.atom AS TEXT) IN (SELECT value FROM json_each(?)) UNION ALL SELECT 1 FROM drill_sessions d,json_tree(d.material_bindings_json) v WHERE CAST(v.atom AS TEXT) IN (SELECT value FROM json_each(?)))`,
        )
        .pluck()
        .get(ids, ids, ids, ids),
    );
  }
}
