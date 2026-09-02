import type {
  ResumeDraftRepository,
  ResumeExportRequestRecord,
  ResumeTemplateDraftRecord,
} from '@jobhunter/application';
import { resumeDocumentContentSchema, resumeTemplateKeySchema } from '@jobhunter/resume-template';
import type Database from 'better-sqlite3';

interface DraftRow {
  readonly id: string;
  readonly profile_id: string;
  readonly template_key: string;
  readonly template_version: number;
  readonly source_profile_version_id: string;
  readonly content_json: string;
  readonly avatar_file_id: string | null;
  readonly avatar_file_version: number | null;
  readonly revision: number;
  readonly created_at: number;
  readonly updated_at: number;
}

interface ExportRow {
  readonly id: string;
  readonly draft_id: string;
  readonly format: string;
  readonly draft_revision: number;
  readonly input_file_id: string;
  readonly input_file_version: number;
  readonly output_file_id: string | null;
  readonly output_file_version: number | null;
  readonly task_id: string | null;
  readonly status: string;
  readonly file_name: string;
  readonly error_summary: string | null;
  readonly expires_at: number;
  readonly created_at: number;
  readonly updated_at: number;
}

function draft(row: DraftRow): ResumeTemplateDraftRecord {
  return {
    id: row.id,
    profileId: row.profile_id,
    templateKey: resumeTemplateKeySchema.parse(row.template_key),
    templateVersion: row.template_version,
    sourceProfileVersionId: row.source_profile_version_id,
    content: resumeDocumentContentSchema.parse(JSON.parse(row.content_json) as unknown),
    avatarFileId: row.avatar_file_id,
    avatarFileVersion: row.avatar_file_version,
    revision: row.revision,
    createdAt: row.created_at as ResumeTemplateDraftRecord['createdAt'],
    updatedAt: row.updated_at as ResumeTemplateDraftRecord['updatedAt'],
  };
}

function exportRequest(row: ExportRow): ResumeExportRequestRecord {
  if (row.format !== 'pdf' && row.format !== 'html')
    throw new TypeError('Stored resume export format is invalid.');
  if (!['pending', 'succeeded', 'failed', 'delivered'].includes(row.status))
    throw new TypeError('Stored resume export status is invalid.');
  return {
    id: row.id,
    draftId: row.draft_id,
    format: row.format,
    draftRevision: row.draft_revision,
    inputFileId: row.input_file_id,
    inputFileVersion: row.input_file_version,
    outputFileId: row.output_file_id,
    outputFileVersion: row.output_file_version,
    taskId: row.task_id,
    status: row.status as ResumeExportRequestRecord['status'],
    fileName: row.file_name,
    errorSummary: row.error_summary,
    expiresAt: row.expires_at as ResumeExportRequestRecord['expiresAt'],
    createdAt: row.created_at as ResumeExportRequestRecord['createdAt'],
    updatedAt: row.updated_at as ResumeExportRequestRecord['updatedAt'],
  };
}

const draftSelect = `SELECT id, profile_id, template_key, template_version,
  source_profile_version_id, content_json, avatar_file_id, avatar_file_version,
  revision, created_at, updated_at FROM resume_template_drafts`;
const exportSelect = `SELECT id, draft_id, format, draft_revision, input_file_id,
  input_file_version, output_file_id, output_file_version, task_id, status,
  file_name, error_summary, expires_at, created_at, updated_at FROM resume_export_requests`;

export class SqliteResumeDraftRepository implements ResumeDraftRepository {
  readonly #client: Database.Database;

  public constructor(client: Database.Database) {
    this.#client = client;
  }

  public find(
    profileId: string,
    templateKey: ResumeTemplateDraftRecord['templateKey'],
    templateVersion: number,
  ): ResumeTemplateDraftRecord | null {
    const row = this.#client
      .prepare(`${draftSelect} WHERE profile_id = ? AND template_key = ? AND template_version = ?`)
      .get(profileId, templateKey, templateVersion) as DraftRow | undefined;
    return row ? draft(row) : null;
  }

  public get(id: string): ResumeTemplateDraftRecord | null {
    const row = this.#client.prepare(`${draftSelect} WHERE id = ?`).get(id) as DraftRow | undefined;
    return row ? draft(row) : null;
  }

  public create(record: ResumeTemplateDraftRecord): ResumeTemplateDraftRecord {
    this.#client
      .prepare(
        `INSERT INTO resume_template_drafts
      (id, profile_id, template_key, template_version, source_profile_version_id,
       content_json, avatar_file_id, avatar_file_version, revision, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.profileId,
        record.templateKey,
        record.templateVersion,
        record.sourceProfileVersionId,
        JSON.stringify(record.content),
        record.avatarFileId,
        record.avatarFileVersion,
        record.revision,
        record.createdAt,
        record.updatedAt,
      );
    return this.get(record.id) ?? record;
  }

  public update(
    input: Parameters<ResumeDraftRepository['update']>[0],
  ): ResumeTemplateDraftRecord | null {
    const result = this.#client
      .prepare(
        `UPDATE resume_template_drafts
      SET content_json = ?, source_profile_version_id = COALESCE(?, source_profile_version_id),
          revision = revision + 1, updated_at = ?
      WHERE id = ? AND revision = ?`,
      )
      .run(
        JSON.stringify(input.content),
        input.sourceProfileVersionId ?? null,
        input.now,
        input.id,
        input.expectedRevision,
      );
    return result.changes === 1 ? this.get(input.id) : null;
  }

  public setAvatar(
    input: Parameters<ResumeDraftRepository['setAvatar']>[0],
  ): ResumeTemplateDraftRecord | null {
    const result = this.#client
      .prepare(
        `UPDATE resume_template_drafts
      SET avatar_file_id = ?, avatar_file_version = ?, revision = revision + 1, updated_at = ?
      WHERE id = ? AND revision = ?`,
      )
      .run(input.fileId, input.fileVersion, input.now, input.id, input.expectedRevision);
    return result.changes === 1 ? this.get(input.id) : null;
  }

  public createExport(record: ResumeExportRequestRecord): ResumeExportRequestRecord {
    this.#client
      .prepare(
        `INSERT INTO resume_export_requests
      (id, draft_id, format, draft_revision, input_file_id, input_file_version,
       output_file_id, output_file_version, task_id, status, file_name, error_summary,
       expires_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.draftId,
        record.format,
        record.draftRevision,
        record.inputFileId,
        record.inputFileVersion,
        record.outputFileId,
        record.outputFileVersion,
        record.taskId,
        record.status,
        record.fileName,
        record.errorSummary,
        record.expiresAt,
        record.createdAt,
        record.updatedAt,
      );
    return this.getExport(record.id) ?? record;
  }

  public getExport(id: string): ResumeExportRequestRecord | null {
    const row = this.#client.prepare(`${exportSelect} WHERE id = ?`).get(id) as
      ExportRow | undefined;
    return row ? exportRequest(row) : null;
  }

  public attachTask(id: string, taskId: string, now: ResumeTemplateDraftRecord['updatedAt']): void {
    this.#client
      .prepare('UPDATE resume_export_requests SET task_id = ?, updated_at = ? WHERE id = ?')
      .run(taskId, now, id);
  }

  public completeExport(input: Parameters<ResumeDraftRepository['completeExport']>[0]): void {
    this.#client
      .prepare(
        `UPDATE resume_export_requests SET output_file_id = ?, output_file_version = ?, status = 'succeeded', error_summary = NULL, updated_at = ? WHERE id = ?`,
      )
      .run(input.outputFileId, input.outputFileVersion, input.now, input.id);
  }

  public failExport(
    id: string,
    message: string,
    now: ResumeTemplateDraftRecord['updatedAt'],
  ): void {
    this.#client
      .prepare(
        `UPDATE resume_export_requests SET status = 'failed', error_summary = ?, updated_at = ? WHERE id = ?`,
      )
      .run(message, now, id);
  }

  public markDelivered(id: string, now: ResumeTemplateDraftRecord['updatedAt']): void {
    this.#client
      .prepare(
        `UPDATE resume_export_requests SET status = 'delivered', updated_at = ? WHERE id = ?`,
      )
      .run(now, id);
  }

  public listExpired(
    now: ResumeTemplateDraftRecord['updatedAt'],
  ): readonly ResumeExportRequestRecord[] {
    return (
      this.#client.prepare(`${exportSelect} WHERE expires_at <= ?`).all(now) as ExportRow[]
    ).map(exportRequest);
  }

  public deleteExport(id: string): void {
    this.#client.prepare('DELETE FROM resume_export_requests WHERE id = ?').run(id);
  }
}
