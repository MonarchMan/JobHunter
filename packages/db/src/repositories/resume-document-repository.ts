import type { ResumeDocumentRecord, ResumeDocumentRepository } from '@jobhunter/application';
import { parseContentHash } from '@jobhunter/domain';
import type { ResumeMediaType, ResumeParseStatus } from '@jobhunter/resume';
import type Database from 'better-sqlite3';

/** 数据库查询结果对应的行结构。 */
interface ResumeDocumentRow {
  readonly id: string;
  readonly artifact_id: string;
  readonly content_hash: string;
  readonly media_type: ResumeMediaType;
  readonly extracted_text: string | null;
  readonly parse_status: ResumeParseStatus;
  readonly parser_version: string | null;
  readonly error_summary: string | null;
  readonly created_at: number;
}

const selection = `SELECT id, artifact_id, content_hash, media_type, extracted_text,
                          parse_status, parser_version, error_summary, created_at
                   FROM (
                     SELECT file.id, version.entity_id AS artifact_id,
                            entity.sha256 AS content_hash, entity.media_type,
                            version.extracted_text, version.parse_status,
                            version.parser_version, version.error_summary, file.created_at
                     FROM files file
                     JOIN file_entity_mappings version ON version.file_id = file.id
                     JOIN entities entity ON entity.id = version.entity_id
                     WHERE file.kind = 'resume' AND version.parse_status IS NOT NULL
                       AND version.version_no = (
                         SELECT MAX(candidate.version_no) FROM file_entity_mappings candidate
                         WHERE candidate.file_id = file.id
                       )
                   )`;

/** 执行数据库结果的解析、转换或持久化辅助逻辑。 */
function toRecord(row: ResumeDocumentRow): ResumeDocumentRecord {
  return {
    id: row.id,
    artifactId: row.artifact_id,
    contentHash: parseContentHash(row.content_hash),
    mediaType: row.media_type,
    extractedText: row.extracted_text,
    parseStatus: row.parse_status,
    parserVersion: row.parser_version,
    errorSummary: row.error_summary,
    createdAt: row.created_at as ResumeDocumentRecord['createdAt'],
  };
}

/** 持久化简历导入文档和实体文件版本映射。 */
export class SqliteResumeDocumentRepository implements ResumeDocumentRepository {
  readonly #client: Database.Database;

  public constructor(client: Database.Database) {
    this.#client = client;
  }

  /** 执行数据库组件对外暴露的操作。 */
  public getById(id: string): ResumeDocumentRecord | null {
    const row = this.#client.prepare(`${selection} WHERE id = ?`).get(id) as
      ResumeDocumentRow | undefined;
    return row ? toRecord(row) : null;
  }

  /** 执行数据库组件对外暴露的操作。 */
  public findByContentHash(
    contentHash: ResumeDocumentRecord['contentHash'],
  ): ResumeDocumentRecord | null {
    const row = this.#client.prepare(`${selection} WHERE content_hash = ?`).get(contentHash) as
      ResumeDocumentRow | undefined;
    return row ? toRecord(row) : null;
  }

  /** 执行数据库组件对外暴露的操作。 */
  public createOrGet(input: ResumeDocumentRecord): ResumeDocumentRecord {
    const existing = this.findByContentHash(input.contentHash);
    if (existing) return existing;
    this.#client.transaction(() => {
      const changed = this.#client
        .prepare(
          `UPDATE files SET kind = 'resume', state = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(input.parseStatus, input.createdAt, input.id).changes;
      if (changed !== 1) throw new TypeError('Resume file was not registered.');
      this.#client
        .prepare(
          `UPDATE file_entity_mappings
           SET parser_version = ?, parse_status = ?, extracted_text = ?, error_summary = ?
           WHERE file_id = ? AND version_no = (
             SELECT MAX(candidate.version_no) FROM file_entity_mappings candidate
             WHERE candidate.file_id = ?
           )`,
        )
        .run(
          input.parserVersion,
          input.parseStatus,
          input.extractedText,
          input.errorSummary,
          input.id,
          input.id,
        );
    })();
    const stored = this.findByContentHash(input.contentHash);
    if (!stored) throw new Error('Resume document persistence did not produce a row.');
    return stored;
  }

  /** 执行数据库组件对外暴露的操作。 */
  public completeOcr(input: {
    readonly id: string;
    readonly extractedText: string;
    readonly parserVersion: string;
  }): ResumeDocumentRecord {
    const text = input.extractedText.trim();
    const parserVersion = input.parserVersion.trim();
    if (!text || !parserVersion) throw new TypeError('OCR result is incomplete.');
    this.#client
      .prepare(
        `UPDATE file_entity_mappings
         SET extracted_text = ?, parse_status = 'parsed', parser_version = ?, error_summary = NULL
         WHERE file_id = ? AND parse_status = 'needs_ocr'
           AND version_no = (
             SELECT MAX(candidate.version_no) FROM file_entity_mappings candidate
             WHERE candidate.file_id = ?
           )`,
      )
      .run(text, parserVersion, input.id, input.id);
    this.#client.prepare("UPDATE files SET state = 'parsed' WHERE id = ?").run(input.id);
    const stored = this.getById(input.id);
    if (!stored) throw new TypeError('Resume document was not found.');
    if (stored.parseStatus !== 'parsed' || stored.extractedText === null) {
      throw new TypeError('Resume document is not awaiting OCR.');
    }
    return stored;
  }
}
