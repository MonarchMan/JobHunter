import type { ResumeDocumentRecord, ResumeDocumentRepository } from '@jobhunter/application';
import { parseContentHash } from '@jobhunter/domain';
import type { ResumeMediaType, ResumeParseStatus } from '@jobhunter/resume';
import type Database from 'better-sqlite3';

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
                   FROM resume_documents`;

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

export class SqliteResumeDocumentRepository implements ResumeDocumentRepository {
  readonly #client: Database.Database;

  public constructor(client: Database.Database) {
    this.#client = client;
  }

  public getById(id: string): ResumeDocumentRecord | null {
    const row = this.#client.prepare(`${selection} WHERE id = ?`).get(id) as
      ResumeDocumentRow | undefined;
    return row ? toRecord(row) : null;
  }

  public findByContentHash(
    contentHash: ResumeDocumentRecord['contentHash'],
  ): ResumeDocumentRecord | null {
    const row = this.#client.prepare(`${selection} WHERE content_hash = ?`).get(contentHash) as
      ResumeDocumentRow | undefined;
    return row ? toRecord(row) : null;
  }

  public createOrGet(input: ResumeDocumentRecord): ResumeDocumentRecord {
    this.#client
      .prepare(
        `INSERT INTO resume_documents
           (id, artifact_id, content_hash, media_type, extracted_text, parse_status,
            parser_version, error_summary, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(content_hash) DO NOTHING`,
      )
      .run(
        input.id,
        input.artifactId,
        input.contentHash,
        input.mediaType,
        input.extractedText,
        input.parseStatus,
        input.parserVersion,
        input.errorSummary,
        input.createdAt,
      );
    const stored = this.findByContentHash(input.contentHash);
    if (!stored) throw new Error('Resume document persistence did not produce a row.');
    return stored;
  }
}
