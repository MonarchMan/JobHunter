import type Database from 'better-sqlite3';
import type {
  ResourceReferenceReader,
  ResourceReferenceSubject,
} from '../contracts/resource-references.js';

/** 通用事件及在途任务的保守引用保护，业务规则由主体参数声明。 */
export class SqliteRuntimeReferenceReader implements ResourceReferenceReader {
  public constructor(private readonly client: Database.Database) {}

  /** 按主体声明的事件与任务身份判断保护，不返回载荷内容。 */
  public isReferenced(subject: ResourceReferenceSubject): boolean {
    // 1、忽略由业务所有者声明的初始事实事件，其余身份和载荷引用全部保护。
    const publicIds = JSON.stringify([subject.id, ...subject.aliases, ...subject.versionIds]);
    const event = this.client
      .prepare(
        `SELECT EXISTS(SELECT 1 FROM events e WHERE e.stream_id IN (SELECT value FROM json_each(?)) OR (e.stream_type=? AND e.stream_id=? AND NOT(e.event_type=? AND coalesce(json_extract(e.payload_json,'$.reasonCode'),'')=?)) OR (NOT(e.stream_type=? AND e.stream_id=? AND e.event_type=? AND coalesce(json_extract(e.payload_json,'$.reasonCode'),'')=?) AND EXISTS(SELECT 1 FROM json_tree(e.payload_json) v WHERE CAST(v.atom AS TEXT) IN (SELECT value FROM json_each(?)))))`,
      )
      .pluck()
      .get(
        JSON.stringify(subject.versionIds),
        subject.streamType,
        subject.id,
        subject.ignoredEventType,
        subject.ignoredReasonCode,
        subject.streamType,
        subject.id,
        subject.ignoredEventType,
        subject.ignoredReasonCode,
        publicIds,
      );
    if (event) return true;
    // 2、保护已声明的广域任务与精确身份引用，不读取或返回任务正文。
    return Boolean(
      this.client
        .prepare(
          `SELECT EXISTS(SELECT 1 FROM tasks t WHERE t.status IN ('pending','running') AND (EXISTS(SELECT 1 FROM json_each(?) prefix WHERE t.task_type LIKE prefix.value||'%') OR EXISTS(SELECT 1 FROM json_tree(t.payload_json) v WHERE CAST(v.atom AS TEXT) IN (SELECT value FROM json_each(?)))))`,
        )
        .pluck()
        .get(
          JSON.stringify(subject.broadTaskPrefixes),
          JSON.stringify([subject.id, ...subject.executionAliases, ...subject.versionIds]),
        ),
    );
  }
}
