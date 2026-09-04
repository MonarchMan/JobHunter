import type {
  ExperienceDeletionSnapshot,
  ExperienceDocumentDetail,
  ExperienceDocumentRecord,
  ExperienceDocumentSummary,
  InterviewExperienceRecord,
  InterviewExperienceRepository,
  InterviewQuestionEntryRecord,
  QuarantinedArtifact,
} from '@jobhunter/application';
import {
  experienceDocumentStatusSchema,
  experienceSourceModeSchema,
  experienceWarningCodeSchema,
  parseContentHash,
  parseId,
  type ExperienceDocumentId,
  type UtcInstant,
} from '@jobhunter/domain';
import type Database from 'better-sqlite3';
import { z } from 'zod';

/** 数据库查询结果对应的行结构。 */
interface DocumentRow {
  readonly id: string;
  readonly artifact_id: string;
  readonly content_hash: string;
  readonly file_name: string;
  readonly media_type: string;
  readonly source_mode: string;
  readonly extracted_text: string;
  readonly normalized_text: string;
  readonly parser_version: string;
  readonly template_version: string | null;
  readonly status: string;
  readonly warnings_json: string;
  readonly revision: number;
  readonly created_at: number;
  readonly updated_at: number;
  readonly accepted_at: number | null;
}

/** 数据库查询结果对应的行结构。 */
interface ExperienceRow {
  readonly id: string;
  readonly document_id: string;
  readonly sequence_no: number;
  readonly company: string | null;
  readonly role: string | null;
  readonly stage: string | null;
  readonly occurred_on: string | null;
  readonly outcome: string | null;
  readonly difficulty: string | null;
  readonly tags_json: string;
  readonly notes: string | null;
}

/** 数据库查询结果对应的行结构。 */
interface QuestionRow {
  readonly id: string;
  readonly experience_id: string;
  readonly sequence_no: number;
  readonly question: string;
  readonly answer: string | null;
  readonly reflection: string | null;
  readonly question_source_start: number | null;
  readonly question_source_end: number | null;
  readonly answer_source_start: number | null;
  readonly answer_source_end: number | null;
}

const documentColumns = `d.id, version.entity_id AS artifact_id, entity.sha256 AS content_hash,
  d.name AS file_name, entity.media_type,
  json_extract(d.properties_json, '$.sourceMode') AS source_mode,
  version.extracted_text, version.normalized_text, version.parser_version,
  json_extract(d.properties_json, '$.templateVersion') AS template_version,
  d.state AS status,
  COALESCE(json_extract(d.properties_json, '$.warnings'), '[]') AS warnings_json,
  d.revision, d.created_at, d.updated_at,
  json_extract(d.properties_json, '$.acceptedAt') AS accepted_at`;
const documentSource = `FROM files d
  JOIN file_entity_mappings version ON version.file_id = d.id
  JOIN entities entity ON entity.id = version.entity_id
  WHERE d.kind = 'interview_experience' AND version.parser_version IS NOT NULL
    AND version.version_no = (
      SELECT MAX(candidate.version_no) FROM file_entity_mappings candidate
      WHERE candidate.file_id = d.id
    )`;
const experienceColumns = `id, file_id AS document_id, sequence_no, company, role, stage, occurred_on,
  outcome, difficulty, tags_json, notes`;
const questionColumns = `id, experience_id, sequence_no, question, answer, reflection,
  question_source_start, question_source_end, answer_source_start, answer_source_end`;

/** 执行数据库结果的解析、转换或持久化辅助逻辑。 */
function json<T>(value: string, schema: z.ZodType<T>): T {
  return schema.parse(JSON.parse(value));
}

/** 执行数据库结果的解析、转换或持久化辅助逻辑。 */
function documentRecord(row: DocumentRow): ExperienceDocumentRecord {
  return {
    id: parseId(row.id, 'ExperienceDocument'),
    artifactId: row.artifact_id,
    contentHash: parseContentHash(row.content_hash),
    fileName: row.file_name,
    mediaType: row.media_type,
    sourceMode: experienceSourceModeSchema.parse(row.source_mode),
    extractedText: row.extracted_text,
    normalizedText: row.normalized_text,
    parserVersion: row.parser_version,
    templateVersion: row.template_version,
    status: experienceDocumentStatusSchema.parse(row.status),
    warnings: json(row.warnings_json, z.array(experienceWarningCodeSchema)),
    revision: row.revision,
    createdAt: row.created_at as UtcInstant,
    updatedAt: row.updated_at as UtcInstant,
    acceptedAt: row.accepted_at as UtcInstant | null,
  };
}

/** 执行数据库结果的解析、转换或持久化辅助逻辑。 */
function experienceRecord(row: ExperienceRow): InterviewExperienceRecord {
  return {
    id: parseId(row.id, 'InterviewExperience'),
    documentId: parseId(row.document_id, 'ExperienceDocument'),
    sequenceNo: row.sequence_no,
    company: row.company,
    role: row.role,
    stage: row.stage,
    occurredOn: row.occurred_on,
    outcome: row.outcome,
    difficulty: row.difficulty,
    tags: json(row.tags_json, z.array(z.string())),
    notes: row.notes,
    questions: [],
  };
}

/** 执行数据库结果的解析、转换或持久化辅助逻辑。 */
function range(start: number | null, end: number | null): { start: number; end: number } | null {
  return start === null || end === null ? null : { start, end };
}

/** 执行数据库结果的解析、转换或持久化辅助逻辑。 */
function questionRecord(row: QuestionRow): InterviewQuestionEntryRecord {
  return {
    id: parseId(row.id, 'InterviewQuestionEntry'),
    experienceId: parseId(row.experience_id, 'InterviewExperience'),
    sequenceNo: row.sequence_no,
    question: row.question,
    answer: row.answer,
    reflection: row.reflection,
    questionEvidence: range(row.question_source_start, row.question_source_end),
    answerEvidence: range(row.answer_source_start, row.answer_source_end),
  };
}

/** 持久化个人面经文档、经历、问题和五版本文件映射。 */
export class SqliteInterviewExperienceRepository implements InterviewExperienceRepository {
  readonly #client: Database.Database;

  public constructor(client: Database.Database) {
    this.#client = client;
  }

  /** 执行数据库组件对外暴露的操作。 */
  public findByContentHash(
    contentHash: ExperienceDocumentRecord['contentHash'],
    parserVersion: string,
  ): ExperienceDocumentDetail | null {
    const id = this.#client
      .prepare(
        `SELECT d.id ${documentSource}
         AND entity.sha256 = ? AND version.parser_version = ?`,
      )
      .pluck()
      .get(contentHash, parserVersion) as string | undefined;
    return id ? this.get(parseId(id, 'ExperienceDocument')) : null;
  }

  /** 执行数据库组件对外暴露的操作。 */
  public createDraft(input: {
    readonly document: ExperienceDocumentRecord;
    readonly experiences: readonly InterviewExperienceRecord[];
    readonly questions: readonly InterviewQuestionEntryRecord[];
  }): { readonly detail: ExperienceDocumentDetail; readonly deduplicated: boolean } {
    return this.#client.transaction(() => {
      const existing = this.findByContentHash(
        input.document.contentHash,
        input.document.parserVersion,
      );
      if (existing) return { detail: existing, deduplicated: true };
      this.#insertDocument(input.document);
      this.#insertRecords(input.experiences, input.questions);
      const detail = this.get(input.document.id);
      if (!detail) throw new TypeError('Created experience document is unavailable.');
      return { detail, deduplicated: false };
    })();
  }

  /** 执行数据库组件对外暴露的操作。 */
  public list(): readonly ExperienceDocumentSummary[] {
    const rows = this.#client
      .prepare(
        `SELECT ${documentColumns},
           (SELECT company FROM interview_experiences e WHERE e.file_id = d.id ORDER BY sequence_no LIMIT 1) AS first_company,
           (SELECT role FROM interview_experiences e WHERE e.file_id = d.id ORDER BY sequence_no LIMIT 1) AS first_role,
           (SELECT stage FROM interview_experiences e WHERE e.file_id = d.id ORDER BY sequence_no LIMIT 1) AS first_stage,
           (SELECT occurred_on FROM interview_experiences e WHERE e.file_id = d.id ORDER BY sequence_no LIMIT 1) AS first_occurred_on,
           (SELECT COUNT(*) FROM interview_experiences e WHERE e.file_id = d.id) AS experience_count,
           (SELECT COUNT(*) FROM interview_question_entries q JOIN interview_experiences e ON e.id = q.experience_id WHERE e.file_id = d.id) AS question_count,
           (SELECT COUNT(*) FROM interview_question_entries q JOIN interview_experiences e ON e.id = q.experience_id WHERE e.file_id = d.id AND q.answer IS NULL) AS unanswered_count
         ${documentSource} ORDER BY d.updated_at DESC, d.id`,
      )
      .all() as (DocumentRow & {
      first_company: string | null;
      first_role: string | null;
      first_stage: string | null;
      first_occurred_on: string | null;
      experience_count: number;
      question_count: number;
      unanswered_count: number;
    })[];
    return rows.map((row) => ({
      document: documentRecord(row),
      company: row.first_company,
      role: row.first_role,
      stage: row.first_stage,
      occurredOn: row.first_occurred_on,
      experienceCount: row.experience_count,
      questionCount: row.question_count,
      unansweredCount: row.unanswered_count,
    }));
  }

  /** 执行数据库组件对外暴露的操作。 */
  public get(id: ExperienceDocumentId): ExperienceDocumentDetail | null {
    const row = this.#client
      .prepare(`SELECT ${documentColumns} ${documentSource} AND d.id = ?`)
      .get(id) as DocumentRow | undefined;
    if (!row) return null;
    const experiences = this.#client
      .prepare(
        `SELECT ${experienceColumns} FROM interview_experiences WHERE file_id = ? ORDER BY sequence_no`,
      )
      .all(id) as ExperienceRow[];
    const questions = this.#client
      .prepare(
        `SELECT ${questionColumns} FROM interview_question_entries
         WHERE experience_id IN (SELECT id FROM interview_experiences WHERE file_id = ?)
         ORDER BY experience_id, sequence_no`,
      )
      .all(id) as QuestionRow[];
    return {
      document: documentRecord(row),
      experiences: experiences.map(experienceRecord),
      questions: questions.map(questionRecord),
    };
  }

  /** 执行数据库组件对外暴露的操作。 */
  public replaceDraft(input: {
    readonly documentId: ExperienceDocumentId;
    readonly expectedRevision: number;
    readonly warnings: ExperienceDocumentRecord['warnings'];
    readonly experiences: readonly InterviewExperienceRecord[];
    readonly questions: readonly InterviewQuestionEntryRecord[];
    readonly now: UtcInstant;
  }): ExperienceDocumentDetail | null {
    return this.#client.transaction(() => {
      const changed = this.#client
        .prepare(
          `UPDATE files
           SET properties_json = json_set(properties_json, '$.warnings', json(?)),
               revision = revision + 1, updated_at = ?
           WHERE id = ? AND kind = 'interview_experience'
             AND state = 'draft' AND revision = ?`,
        )
        .run(
          JSON.stringify(input.warnings),
          input.now,
          input.documentId,
          input.expectedRevision,
        ).changes;
      if (changed !== 1) return null;
      this.#client
        .prepare('DELETE FROM interview_experiences WHERE file_id = ?')
        .run(input.documentId);
      this.#insertRecords(input.experiences, input.questions);
      return this.get(input.documentId);
    })();
  }

  /** 执行数据库组件对外暴露的操作。 */
  public accept(input: {
    readonly documentId: ExperienceDocumentId;
    readonly expectedRevision: number;
    readonly now: UtcInstant;
  }): ExperienceDocumentDetail | null {
    return this.#client.transaction(() => {
      const count = Number(
        this.#client
          .prepare(
            `SELECT COUNT(*) FROM interview_question_entries q
             JOIN interview_experiences e ON e.id = q.experience_id WHERE e.file_id = ?`,
          )
          .pluck()
          .get(input.documentId),
      );
      if (count < 1) return null;
      const changed = this.#client
        .prepare(
          `UPDATE files SET state = 'accepted',
             properties_json = json_set(properties_json, '$.acceptedAt', ?),
             updated_at = ?, revision = revision + 1
           WHERE id = ? AND kind = 'interview_experience'
             AND state = 'draft' AND revision = ?`,
        )
        .run(input.now, input.now, input.documentId, input.expectedRevision).changes;
      if (changed !== 1) return null;
      this.#client
        .prepare(
          `UPDATE interview_experiences SET review_status = 'accepted'
           WHERE file_id = ? AND source_type = 'personal'`,
        )
        .run(input.documentId);
      return this.get(input.documentId);
    })();
  }

  /** 执行数据库组件对外暴露的操作。 */
  public previewDeletion(documentId: ExperienceDocumentId): ExperienceDeletionSnapshot | null {
    const row = this.#client
      .prepare(
        `SELECT d.revision, version.entity_id AS artifact_id, entity.relative_path
         FROM files d
         JOIN file_entity_mappings version ON version.file_id = d.id
         JOIN entities entity ON entity.id = version.entity_id
         WHERE d.id = ? AND d.kind = 'interview_experience'
           AND version.version_no = (
             SELECT MAX(candidate.version_no) FROM file_entity_mappings candidate
             WHERE candidate.file_id = d.id
           )`,
      )
      .get(documentId) as
      { revision: number; artifact_id: string; relative_path: string } | undefined;
    if (!row) return null;
    const experienceIds = (
      this.#client
        .prepare('SELECT id FROM interview_experiences WHERE file_id = ? ORDER BY id')
        .pluck()
        .all(documentId) as string[]
    ).map((id) => parseId(id, 'InterviewExperience'));
    const questionIds = (
      this.#client
        .prepare(
          `SELECT q.id FROM interview_question_entries q
           JOIN interview_experiences e ON e.id = q.experience_id
           WHERE e.file_id = ? ORDER BY q.id`,
        )
        .pluck()
        .all(documentId) as string[]
    ).map((id) => parseId(id, 'InterviewQuestionEntry'));
    const shared =
      this.#client
        .prepare(
          `SELECT EXISTS(
             SELECT 1 FROM file_entity_mappings
             WHERE entity_id = ? AND file_id != ?
           )`,
        )
        .pluck()
        .get(row.artifact_id, documentId) === 1;
    return {
      documentId,
      documentRevision: row.revision,
      experienceIds,
      questionIds,
      artifactId: row.artifact_id,
      artifactRelativePath: row.relative_path,
      artifactShared: shared,
    };
  }

  /** 执行数据库组件对外暴露的操作。 */
  public deleteDocument(input: {
    readonly expected: ExperienceDeletionSnapshot;
    readonly quarantinedArtifact: QuarantinedArtifact | null;
    readonly deletedAt: UtcInstant;
  }): boolean {
    return this.#client.transaction(() => {
      const current = this.previewDeletion(input.expected.documentId);
      if (!current || JSON.stringify(current) !== JSON.stringify(input.expected)) return false;
      const requiresQuarantine = !current.artifactShared && current.artifactRelativePath !== null;
      if (
        requiresQuarantine !== Boolean(input.quarantinedArtifact) ||
        (input.quarantinedArtifact &&
          (input.quarantinedArtifact.artifactId !== current.artifactId ||
            input.quarantinedArtifact.originalRelativePath !== current.artifactRelativePath))
      ) {
        throw new TypeError('Experience artifact quarantine does not match deletion impact.');
      }
      this.#client.prepare('DELETE FROM files WHERE id = ?').run(current.documentId);
      if (input.quarantinedArtifact) {
        this.#client
          .prepare(
            `UPDATE entities SET relative_path = ?, deleted_at = ?
             WHERE id = ? AND deleted_at IS NULL`,
          )
          .run(
            input.quarantinedArtifact.quarantinedRelativePath,
            input.deletedAt,
            input.quarantinedArtifact.artifactId,
          );
      }
      return true;
    })();
  }

  /** 执行数据库组件对外暴露的操作。 */
  public removePurgedArtifact(artifactId: string): void {
    this.#client
      .prepare(
        `DELETE FROM entities WHERE id = ? AND deleted_at IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM file_entity_mappings WHERE entity_id = ?)`,
      )
      .run(artifactId, artifactId);
  }

  /** 处理数据库类内部的辅助逻辑。 */
  #insertDocument(document: ExperienceDocumentRecord): void {
    this.#client
      .prepare(
        `UPDATE files SET kind = 'interview_experience', name = ?, state = ?, revision = ?,
           properties_json = json_object(
             'sourceMode', ?, 'templateVersion', ?, 'warnings', json(?), 'acceptedAt', ?
           ), updated_at = ?
         WHERE id = ?`,
      )
      .run(
        document.fileName,
        document.status,
        document.revision,
        document.sourceMode,
        document.templateVersion,
        JSON.stringify(document.warnings),
        document.acceptedAt,
        document.updatedAt,
        document.id,
      );
    this.#client
      .prepare(
        `UPDATE file_entity_mappings
         SET parser_version = ?, parse_status = 'parsed', extracted_text = ?, normalized_text = ?
         WHERE file_id = ? AND entity_id = ?`,
      )
      .run(
        document.parserVersion,
        document.extractedText,
        document.normalizedText,
        document.id,
        document.artifactId,
      );
  }

  /** 处理数据库类内部的辅助逻辑。 */
  #insertRecords(
    experiences: readonly InterviewExperienceRecord[],
    questions: readonly InterviewQuestionEntryRecord[],
  ): void {
    const insertExperience = this.#client.prepare(
      `INSERT INTO interview_experiences
       (id, file_id, sequence_no, company, role, stage, occurred_on,
        outcome, difficulty, tags_json, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    experiences.forEach((experience) =>
      insertExperience.run(
        experience.id,
        experience.documentId,
        experience.sequenceNo,
        experience.company,
        experience.role,
        experience.stage,
        experience.occurredOn,
        experience.outcome,
        experience.difficulty,
        JSON.stringify(experience.tags),
        experience.notes,
      ),
    );
    const insertQuestion = this.#client.prepare(
      `INSERT INTO interview_question_entries (${questionColumns})
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    questions.forEach((question) =>
      insertQuestion.run(
        question.id,
        question.experienceId,
        question.sequenceNo,
        question.question,
        question.answer,
        question.reflection,
        question.questionEvidence?.start ?? null,
        question.questionEvidence?.end ?? null,
        question.answerEvidence?.start ?? null,
        question.answerEvidence?.end ?? null,
      ),
    );
  }
}
