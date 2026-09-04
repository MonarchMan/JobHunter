import type {
  DossierDeletionSnapshot,
  DrillAnswerRevisionRecord,
  DrillCoverageRecord,
  DrillSessionRecord,
  DrillTurnRecord,
  InterviewProjectRepository,
  ProjectAnswerContext,
  ProjectDossierDetail,
  ProjectDossierRecord,
  ProjectDossierSummary,
  ProjectKnowledgeItemRecord,
  ProjectMaterialBinding,
  ProjectMaterialChunkRecord,
  ProjectMaterialContext,
  ProjectMaterialRecord,
  ProjectQuestionContext,
  QuarantinedArtifact,
  ResumeProjectSnapshotRecord,
} from '@jobhunter/application';
import {
  candidateProjectSchema,
  contentHash,
  drillCoverageDimensionSchema,
  drillCoverageStatusSchema,
  drillEvidenceRefSchema,
  drillSessionStatusSchema,
  drillTurnStatusSchema,
  parseContentHash,
  parseId,
  projectKnowledgeKindSchema,
  type DrillAnswerRevisionId,
  type DrillSessionId,
  type DrillTurnId,
  type ProjectDossierId,
  type TaskId,
  type UtcInstant,
} from '@jobhunter/domain';
import type Database from 'better-sqlite3';
import { z } from 'zod';

/** 数据库查询结果对应的行结构。 */
interface SnapshotRow {
  readonly id: string;
  readonly source_profile_id: string;
  readonly source_profile_version_id: string;
  readonly project_index: number;
  readonly project_json: string;
  readonly content_hash: string;
  readonly created_at: number;
}

/** 数据库查询结果对应的行结构。 */
interface DossierRow {
  readonly id: string;
  readonly snapshot_id: string;
  readonly latest_notebook_artifact_id: string | null;
  readonly notebook_source_hash: string | null;
  readonly revision: number;
  readonly created_at: number;
  readonly updated_at: number;
}

/** 数据库查询结果对应的行结构。 */
interface SessionRow {
  readonly id: string;
  readonly dossier_id: string;
  readonly profile_key: string;
  readonly profile_version: string;
  readonly profile_definition_hash: string;
  readonly capability_summary_json: string;
  readonly material_bindings_json: string;
  readonly status: string;
  readonly context_revision: number;
  readonly created_at: number;
  readonly updated_at: number;
  readonly completed_at: number | null;
}

/** 数据库查询结果对应的行结构。 */
interface MaterialRow {
  readonly file_id: string;
  readonly entity_id: string;
  readonly version_no: number;
  readonly file_name: string;
  readonly file_state: string;
  readonly file_properties_json: string;
  readonly media_type: string;
  readonly content_hash: string;
  readonly byte_size: number;
  readonly normalized_text: string | null;
  readonly parser_version: string | null;
  readonly parse_status: string | null;
  readonly metadata_json: string;
  readonly version_created_at: number;
  readonly file_created_at: number;
}

/** 数据库查询结果对应的行结构。 */
interface TurnRow {
  readonly id: string;
  readonly session_id: string;
  readonly turn_no: number;
  readonly status: string;
  readonly context_hash: string;
  readonly question: string | null;
  readonly intent: string | null;
  readonly primary_dimension: string | null;
  readonly guidance_slots_json: string;
  readonly evidence_refs_json: string;
  readonly question_task_id: string | null;
  readonly question_agent_run_id: string | null;
  readonly digest_task_id: string | null;
  readonly digest_agent_run_id: string | null;
  readonly created_at: number;
  readonly updated_at: number;
}

/** 数据库查询结果对应的行结构。 */
interface AnswerRow {
  readonly id: string;
  readonly turn_id: string;
  readonly revision_no: number;
  readonly answer_text: string;
  readonly content_hash: string;
  readonly idempotency_key: string;
  readonly created_at: number;
}

/** 数据库查询结果对应的行结构。 */
interface KnowledgeRow {
  readonly id: string;
  readonly dossier_id: string;
  readonly source_answer_revision_id: string;
  readonly kind: string;
  readonly statement: string;
  readonly quote: string;
  readonly source_start: number;
  readonly source_end: number;
  readonly status: string;
  readonly created_at: number;
}

/** 数据库查询结果对应的行结构。 */
interface CoverageRow {
  readonly session_id: string;
  readonly dimension: string;
  readonly status: string;
  readonly evidence_item_ids_json: string;
  readonly updated_at: number;
}

const resumeOnlyCapabilitySummarySchema = z
  .object({
    evidenceKinds: z.tuple([
      z.literal('resume_project'),
      z.literal('user_answer'),
      z.literal('derived_claim'),
    ]),
    tools: z.tuple([]),
  })
  .strict();

const docsGroundedCapabilitySummarySchema = z
  .object({
    evidenceKinds: z.tuple([
      z.literal('resume_project'),
      z.literal('user_answer'),
      z.literal('derived_claim'),
      z.literal('project_material'),
    ]),
    tools: z.tuple([
      z.literal('selected_markdown_heading_search'),
      z.literal('selected_markdown_chunk_read'),
    ]),
  })
  .strict();

const materialFileNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .regex(/^[^/\\]+\.(?:md|mdx)$/iu);

const materialBindingJsonSchema = z
  .object({
    fileId: z.uuid(),
    entityId: z.uuid(),
    versionNo: z.number().int().min(1).max(5),
    fileName: materialFileNameSchema,
    contentHash: z.string().length(64),
  })
  .strict();

const materialBindingsJsonSchema = z.array(materialBindingJsonSchema).max(8);

const materialChunkJsonSchema = z
  .object({
    id: z.uuid(),
    heading: z.string().trim().min(1).max(500).nullable(),
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
    contentHash: z.string().length(64),
  })
  .strict();

const materialMetadataSchema = z
  .object({ chunks: z.array(materialChunkJsonSchema).min(1).max(200) })
  .strict();

const materialPropertiesSchema = z
  .object({ dossierId: z.uuid(), fileName: materialFileNameSchema })
  .strict();

/** 执行数据库结果的解析、转换或持久化辅助逻辑。 */
function parseJson<T>(schema: z.ZodType<T>, value: string): T {
  return schema.parse(JSON.parse(value) as unknown);
}

/** 执行数据库结果的解析、转换或持久化辅助逻辑。 */
function materialBinding(value: z.infer<typeof materialBindingJsonSchema>): ProjectMaterialBinding {
  return { ...value, contentHash: parseContentHash(value.contentHash) };
}

/** 执行数据库结果的解析、转换或持久化辅助逻辑。 */
function parseMaterialBindings(value: string): readonly ProjectMaterialBinding[] {
  const parsed = parseJson(materialBindingsJsonSchema, value);
  const fileIds = new Set(parsed.map((binding) => binding.fileId));
  if (fileIds.size !== parsed.length) {
    throw new TypeError('Stored project material bindings contain duplicate files.');
  }
  return parsed.map(materialBinding);
}

/** 执行数据库结果的解析、转换或持久化辅助逻辑。 */
function parseCapabilitySummary(
  profileKey: DrillSessionRecord['profileKey'],
  value: string,
): DrillSessionRecord['capabilitySummary'] {
  if (profileKey === 'docs-grounded') {
    return parseJson(docsGroundedCapabilitySummarySchema, value);
  }
  return parseJson(resumeOnlyCapabilitySummarySchema, value);
}

/** 执行数据库结果的解析、转换或持久化辅助逻辑。 */
function materialChunks(
  metadataJson: string,
  normalizedText: string,
): readonly (ProjectMaterialChunkRecord & { readonly text: string })[] {
  const metadata = parseJson(materialMetadataSchema, metadataJson);
  const ids = new Set<string>();
  let previousEnd = 0;
  return metadata.chunks.map((value) => {
    if (ids.has(value.id)) throw new TypeError('Stored project material chunk ID is duplicated.');
    ids.add(value.id);
    if (
      value.start >= value.end ||
      value.end > normalizedText.length ||
      value.start < previousEnd
    ) {
      throw new TypeError('Stored project material chunk range is invalid.');
    }
    const text = normalizedText.slice(value.start, value.end);
    if (contentHash(text) !== value.contentHash) {
      throw new TypeError('Stored project material chunk hash does not match its text.');
    }
    previousEnd = value.end;
    return {
      id: parseId(value.id, 'ProjectMaterialChunk'),
      heading: value.heading,
      start: value.start,
      end: value.end,
      contentHash: parseContentHash(value.contentHash),
      text,
    };
  });
}

/** 执行数据库结果的解析、转换或持久化辅助逻辑。 */
function materialRecord(row: MaterialRow): ProjectMaterialContext {
  const properties = parseJson(materialPropertiesSchema, row.file_properties_json);
  if (
    row.file_state !== 'stored' ||
    row.media_type !== 'text/markdown; charset=utf-8' ||
    row.byte_size < 1 ||
    row.byte_size > 512 * 1024 ||
    row.parser_version === null ||
    row.parse_status !== 'parsed' ||
    row.normalized_text === null ||
    row.normalized_text.length < 1 ||
    row.normalized_text.length > 512 * 1024 ||
    properties.fileName !== row.file_name
  ) {
    throw new TypeError('Stored project material is invalid.');
  }
  return {
    fileId: row.file_id,
    entityId: row.entity_id,
    versionNo: row.version_no,
    fileName: row.file_name,
    contentHash: parseContentHash(row.content_hash),
    dossierId: parseId(properties.dossierId, 'ProjectDossier'),
    mediaType: row.media_type,
    byteSize: row.byte_size,
    chunks: materialChunks(row.metadata_json, row.normalized_text),
    createdAt: row.file_created_at as UtcInstant,
    updatedAt: row.version_created_at as UtcInstant,
  };
}

/** 执行数据库结果的解析、转换或持久化辅助逻辑。 */
function publicMaterialRecord(row: MaterialRow): ProjectMaterialRecord {
  const record = materialRecord(row);
  return {
    ...record,
    chunks: record.chunks.map((chunk) => ({
      id: chunk.id,
      heading: chunk.heading,
      start: chunk.start,
      end: chunk.end,
      contentHash: chunk.contentHash,
    })),
  };
}

/** 执行数据库结果的解析、转换或持久化辅助逻辑。 */
function bindingFromMaterial(material: ProjectMaterialRecord): ProjectMaterialBinding {
  return {
    fileId: material.fileId,
    entityId: material.entityId,
    versionNo: material.versionNo,
    fileName: material.fileName,
    contentHash: material.contentHash,
  };
}

/** 执行数据库结果的解析、转换或持久化辅助逻辑。 */
function snapshotRecord(row: SnapshotRow): ResumeProjectSnapshotRecord {
  return {
    id: parseId(row.id, 'ResumeProjectSnapshot'),
    sourceProfileId: parseId(row.source_profile_id, 'CandidateProfile'),
    sourceProfileVersionId: parseId(row.source_profile_version_id, 'ProfileVersion'),
    projectIndex: row.project_index,
    project: parseJson(candidateProjectSchema, row.project_json),
    contentHash: parseContentHash(row.content_hash),
    createdAt: row.created_at as UtcInstant,
  };
}

/** 执行数据库结果的解析、转换或持久化辅助逻辑。 */
function dossierRecord(row: DossierRow): ProjectDossierRecord {
  return {
    id: parseId(row.id, 'ProjectDossier'),
    snapshotId: parseId(row.snapshot_id, 'ResumeProjectSnapshot'),
    latestNotebookArtifactId: row.latest_notebook_artifact_id,
    notebookSourceHash:
      row.notebook_source_hash === null ? null : parseContentHash(row.notebook_source_hash),
    revision: row.revision,
    createdAt: row.created_at as UtcInstant,
    updatedAt: row.updated_at as UtcInstant,
  };
}

/** 执行数据库结果的解析、转换或持久化辅助逻辑。 */
function sessionRecord(row: SessionRow): DrillSessionRecord {
  if (
    (row.profile_key !== 'resume-only' && row.profile_key !== 'docs-grounded') ||
    row.profile_version !== 'v1'
  ) {
    throw new TypeError('Stored drill profile is unsupported.');
  }
  const materialBindings = parseMaterialBindings(row.material_bindings_json);
  if (
    (row.profile_key === 'resume-only' && materialBindings.length !== 0) ||
    (row.profile_key === 'docs-grounded' && materialBindings.length === 0)
  ) {
    throw new TypeError('Stored drill profile material bindings are invalid.');
  }
  return {
    id: parseId(row.id, 'DrillSession'),
    dossierId: parseId(row.dossier_id, 'ProjectDossier'),
    profileKey: row.profile_key,
    profileVersion: row.profile_version,
    profileDefinitionHash: parseContentHash(row.profile_definition_hash),
    capabilitySummary: parseCapabilitySummary(row.profile_key, row.capability_summary_json),
    materialBindings,
    status: drillSessionStatusSchema.parse(row.status),
    contextRevision: row.context_revision,
    createdAt: row.created_at as UtcInstant,
    updatedAt: row.updated_at as UtcInstant,
    completedAt: row.completed_at as UtcInstant | null,
  };
}

/** 执行数据库结果的解析、转换或持久化辅助逻辑。 */
function turnRecord(row: TurnRow): DrillTurnRecord {
  return {
    id: parseId(row.id, 'DrillTurn'),
    sessionId: parseId(row.session_id, 'DrillSession'),
    turnNo: row.turn_no,
    status: drillTurnStatusSchema.parse(row.status),
    contextHash: parseContentHash(row.context_hash),
    question: row.question,
    intent: row.intent,
    primaryDimension:
      row.primary_dimension === null
        ? null
        : drillCoverageDimensionSchema.parse(row.primary_dimension),
    guidanceSlots: parseJson(z.array(z.string()), row.guidance_slots_json),
    evidenceRefs: parseJson(z.array(drillEvidenceRefSchema), row.evidence_refs_json),
    questionTaskId: row.question_task_id === null ? null : parseId(row.question_task_id, 'Task'),
    questionAgentRunId:
      row.question_agent_run_id === null ? null : parseId(row.question_agent_run_id, 'AgentRun'),
    digestTaskId: row.digest_task_id === null ? null : parseId(row.digest_task_id, 'Task'),
    digestAgentRunId:
      row.digest_agent_run_id === null ? null : parseId(row.digest_agent_run_id, 'AgentRun'),
    createdAt: row.created_at as UtcInstant,
    updatedAt: row.updated_at as UtcInstant,
  };
}

/** 执行数据库结果的解析、转换或持久化辅助逻辑。 */
function answerRecord(row: AnswerRow): DrillAnswerRevisionRecord {
  return {
    id: parseId(row.id, 'DrillAnswerRevision'),
    turnId: parseId(row.turn_id, 'DrillTurn'),
    revisionNo: row.revision_no,
    answer: row.answer_text,
    contentHash: parseContentHash(row.content_hash),
    idempotencyKey: row.idempotency_key,
    createdAt: row.created_at as UtcInstant,
  };
}

/** 执行数据库结果的解析、转换或持久化辅助逻辑。 */
function knowledgeRecord(row: KnowledgeRow): ProjectKnowledgeItemRecord {
  if (row.status !== 'active' && row.status !== 'superseded') {
    throw new TypeError('Stored project knowledge status is invalid.');
  }
  return {
    id: parseId(row.id, 'ProjectKnowledgeItem'),
    dossierId: parseId(row.dossier_id, 'ProjectDossier'),
    sourceAnswerRevisionId: parseId(row.source_answer_revision_id, 'DrillAnswerRevision'),
    kind: projectKnowledgeKindSchema.parse(row.kind),
    statement: row.statement,
    quote: row.quote,
    start: row.source_start,
    end: row.source_end,
    status: row.status,
    createdAt: row.created_at as UtcInstant,
  };
}

/** 执行数据库结果的解析、转换或持久化辅助逻辑。 */
function coverageRecord(row: CoverageRow): DrillCoverageRecord {
  return {
    sessionId: parseId(row.session_id, 'DrillSession'),
    dimension: drillCoverageDimensionSchema.parse(row.dimension),
    status: drillCoverageStatusSchema.parse(row.status),
    evidenceItemIds: parseJson(z.array(z.uuid()), row.evidence_item_ids_json).map((id) =>
      parseId(id, 'ProjectKnowledgeItem'),
    ),
    updatedAt: row.updated_at as UtcInstant,
  };
}

const snapshotColumns = `id, source_profile_id, source_profile_version_id, project_index,
                         project_json, content_hash, created_at`;
const dossierColumns = `id, snapshot_id, notebook_file_id AS latest_notebook_artifact_id, notebook_source_hash,
                        revision, created_at, updated_at`;
const sessionColumns = `id, dossier_id, profile_key, profile_version, profile_definition_hash,
                        capability_summary_json, material_bindings_json, status, context_revision,
                        created_at, updated_at, completed_at`;
const materialColumns = `file.id AS file_id, entity.id AS entity_id,
                         mapping.version_no AS version_no, file.name AS file_name,
                         file.state AS file_state, file.properties_json AS file_properties_json,
                         entity.media_type AS media_type, entity.sha256 AS content_hash,
                         entity.byte_size AS byte_size, mapping.normalized_text AS normalized_text,
                         mapping.parser_version AS parser_version,
                         mapping.parse_status AS parse_status,
                         mapping.metadata_json AS metadata_json,
                         mapping.created_at AS version_created_at,
                         file.created_at AS file_created_at`;
const materialSource = `FROM files file
                        JOIN file_entity_mappings mapping ON mapping.file_id = file.id
                        JOIN entities entity ON entity.id = mapping.entity_id
                        WHERE file.kind = 'project_material' AND entity.deleted_at IS NULL`;
const turnColumns = `id, session_id, turn_no, status, context_hash, question, intent,
                     primary_dimension, guidance_slots_json, evidence_refs_json, question_task_id,
                     question_agent_run_id, digest_task_id, digest_agent_run_id, created_at,
                     updated_at`;
const answerColumns = `id, turn_id, revision_no, answer_text, content_hash, idempotency_key,
                       created_at`;
const knowledgeColumns = `id, dossier_id, source_answer_revision_id, kind, statement, quote,
                          source_start, source_end, status, created_at`;
const coverageColumns = `session_id, dimension, status, evidence_item_ids_json, updated_at`;

/** 持久化项目快照、拷打会话、回答知识项和资料映射。 */
export class SqliteInterviewProjectRepository implements InterviewProjectRepository {
  readonly #client: Database.Database;

  public constructor(client: Database.Database) {
    this.#client = client;
  }

  /** 执行数据库组件对外暴露的操作。 */
  public createDossier(input: {
    readonly dossier: ProjectDossierRecord;
    readonly snapshot: ResumeProjectSnapshotRecord;
  }): { readonly dossier: ProjectDossierRecord; readonly deduplicated: boolean } {
    return this.#client.transaction(() => {
      const existingSnapshot = this.#client
        .prepare(
          `SELECT ${snapshotColumns} FROM resume_project_snapshots
           WHERE source_profile_version_id = ? AND project_index = ? AND content_hash = ?`,
        )
        .get(
          input.snapshot.sourceProfileVersionId,
          input.snapshot.projectIndex,
          input.snapshot.contentHash,
        ) as SnapshotRow | undefined;
      if (existingSnapshot) {
        const existingDossier = this.#client
          .prepare(`SELECT ${dossierColumns} FROM project_dossiers WHERE snapshot_id = ?`)
          .get(existingSnapshot.id) as DossierRow | undefined;
        if (!existingDossier) throw new TypeError('Project snapshot has no dossier.');
        return { dossier: dossierRecord(existingDossier), deduplicated: true };
      }
      const snapshot = input.snapshot;
      this.#client
        .prepare(
          `INSERT INTO resume_project_snapshots
           (id, source_profile_id, source_profile_version_id, project_index, project_json,
            content_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          snapshot.id,
          snapshot.sourceProfileId,
          snapshot.sourceProfileVersionId,
          snapshot.projectIndex,
          JSON.stringify(snapshot.project),
          snapshot.contentHash,
          snapshot.createdAt,
        );
      const dossier = input.dossier;
      this.#client
        .prepare(
          `INSERT INTO project_dossiers
           (id, snapshot_id, notebook_file_id, notebook_source_hash, revision,
            created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          dossier.id,
          dossier.snapshotId,
          dossier.latestNotebookArtifactId,
          dossier.notebookSourceHash,
          dossier.revision,
          dossier.createdAt,
          dossier.updatedAt,
        );
      return { dossier, deduplicated: false };
    })();
  }

  /** 执行数据库组件对外暴露的操作。 */
  public listDossiers(): readonly ProjectDossierSummary[] {
    const rows = this.#client
      .prepare(`SELECT ${dossierColumns} FROM project_dossiers ORDER BY updated_at DESC, id`)
      .all() as DossierRow[];
    return rows.map((row) => {
      const snapshot = this.#client
        .prepare(`SELECT ${snapshotColumns} FROM resume_project_snapshots WHERE id = ?`)
        .get(row.snapshot_id) as SnapshotRow;
      const sessions = Number(
        this.#client
          .prepare('SELECT count(*) FROM drill_sessions WHERE dossier_id = ?')
          .pluck()
          .get(row.id),
      );
      const activeSessionId = this.#client
        .prepare(
          `SELECT id FROM drill_sessions WHERE dossier_id = ?
           AND status IN ('active', 'paused') LIMIT 1`,
        )
        .pluck()
        .get(row.id) as string | undefined;
      return {
        dossier: dossierRecord(row),
        snapshot: snapshotRecord(snapshot),
        sourceAvailable:
          this.#client
            .prepare('SELECT EXISTS(SELECT 1 FROM profile_versions WHERE id = ?)')
            .pluck()
            .get(snapshot.source_profile_version_id) === 1,
        sessions,
        activeSessionId: activeSessionId ? parseId(activeSessionId, 'DrillSession') : null,
      };
    });
  }

  /** 执行数据库组件对外暴露的操作。 */
  public getDossier(id: ProjectDossierId): ProjectDossierDetail | null {
    const dossier = this.#client
      .prepare(`SELECT ${dossierColumns} FROM project_dossiers WHERE id = ?`)
      .get(id) as DossierRow | undefined;
    if (!dossier) return null;
    const snapshot = this.#client
      .prepare(`SELECT ${snapshotColumns} FROM resume_project_snapshots WHERE id = ?`)
      .get(dossier.snapshot_id) as SnapshotRow;
    const sessions = this.#client
      .prepare(
        `SELECT ${sessionColumns} FROM drill_sessions WHERE dossier_id = ? ORDER BY created_at`,
      )
      .all(id) as SessionRow[];
    const turns = this.#client
      .prepare(
        `SELECT ${turnColumns} FROM drill_turns
         WHERE session_id IN (SELECT id FROM drill_sessions WHERE dossier_id = ?)
         ORDER BY created_at, turn_no`,
      )
      .all(id) as TurnRow[];
    const answers = this.#client
      .prepare(
        `SELECT ${answerColumns} FROM drill_answer_revisions
         WHERE turn_id IN (SELECT dt.id FROM drill_turns dt JOIN drill_sessions ds
           ON ds.id = dt.session_id WHERE ds.dossier_id = ?)
         ORDER BY created_at, revision_no`,
      )
      .all(id) as AnswerRow[];
    const knowledge = this.#client
      .prepare(
        `SELECT ${knowledgeColumns} FROM project_knowledge_items
         WHERE dossier_id = ? ORDER BY created_at, id`,
      )
      .all(id) as KnowledgeRow[];
    const coverage = this.#client
      .prepare(
        `SELECT ${coverageColumns} FROM drill_coverage
         WHERE session_id IN (SELECT id FROM drill_sessions WHERE dossier_id = ?)
         ORDER BY session_id, dimension`,
      )
      .all(id) as CoverageRow[];
    const materials = this.#client
      .prepare(
        `SELECT ${materialColumns} ${materialSource}
         AND json_valid(file.properties_json)
         AND json_extract(file.properties_json, '$.dossierId') = ?
         AND mapping.parser_version IS NOT NULL
         AND mapping.parse_status = 'parsed'
         AND mapping.normalized_text IS NOT NULL
         ORDER BY file.created_at, file.id, mapping.version_no`,
      )
      .all(id) as MaterialRow[];
    const sessionRecords = sessions.map(sessionRecord);
    return {
      dossier: dossierRecord(dossier),
      snapshot: snapshotRecord(snapshot),
      sourceAvailable:
        this.#client
          .prepare('SELECT EXISTS(SELECT 1 FROM profile_versions WHERE id = ?)')
          .pluck()
          .get(snapshot.source_profile_version_id) === 1,
      sessions: sessionRecords.length,
      activeSessionId: sessionRecords.find((session) => session.status !== 'completed')?.id ?? null,
      sessionRecords,
      turns: turns.map(turnRecord),
      answers: answers.map(answerRecord),
      knowledgeItems: knowledge.map(knowledgeRecord),
      coverage: coverage.map(coverageRecord),
      materials: materials.map(publicMaterialRecord),
    };
  }

  /** 执行数据库组件对外暴露的操作。 */
  public findMaterialByName(
    dossierId: ProjectDossierId,
    fileName: string,
  ): ProjectMaterialRecord | null {
    const row = this.#client
      .prepare(
        `SELECT ${materialColumns} ${materialSource}
         AND json_valid(file.properties_json)
         AND json_extract(file.properties_json, '$.dossierId') = ?
         AND json_extract(file.properties_json, '$.fileName') = ?
         AND file.name = ?
         AND mapping.parser_version IS NOT NULL
         AND mapping.parse_status = 'parsed'
         AND mapping.normalized_text IS NOT NULL
         AND mapping.version_no = (
           SELECT MAX(candidate.version_no) FROM file_entity_mappings candidate
           JOIN entities candidate_entity ON candidate_entity.id = candidate.entity_id
           WHERE candidate.file_id = file.id
             AND candidate_entity.deleted_at IS NULL
             AND candidate.parser_version IS NOT NULL
             AND candidate.parse_status = 'parsed'
             AND candidate.normalized_text IS NOT NULL
         )
         ORDER BY file.updated_at DESC, file.id LIMIT 1`,
      )
      .get(dossierId, fileName, fileName) as MaterialRow | undefined;
    return row ? publicMaterialRecord(row) : null;
  }

  /** 执行数据库组件对外暴露的操作。 */
  public claimMaterialFile(input: {
    readonly dossierId: ProjectDossierId;
    readonly fileName: string;
    readonly proposedFileId: string;
    readonly now: UtcInstant;
  }): string {
    z.uuid().parse(input.proposedFileId);
    materialFileNameSchema.parse(input.fileName);
    const propertiesJson = JSON.stringify({
      dossierId: input.dossierId,
      fileName: input.fileName,
    });
    const claim = this.#client.transaction(() => {
      const dossierExists = this.#client
        .prepare('SELECT 1 FROM project_dossiers WHERE id = ?')
        .get(input.dossierId);
      if (!dossierExists) throw new TypeError('Project material dossier does not exist.');

      const existing = this.#client
        .prepare(
          `SELECT id, name FROM files
           WHERE kind = 'project_material'
             AND json_valid(properties_json)
             AND json_extract(properties_json, '$.dossierId') = ?
             AND json_extract(properties_json, '$.fileName') = ?
           LIMIT 1`,
        )
        .get(input.dossierId, input.fileName) as
        { readonly id: string; readonly name: string } | undefined;
      if (existing) {
        if (existing.name !== input.fileName) {
          throw new TypeError('Project material logical file name is inconsistent.');
        }
        return existing.id;
      }

      this.#client
        .prepare(
          `INSERT INTO files
           (id, kind, name, state, revision, properties_json, created_at, updated_at)
           VALUES (?, 'project_material', ?, 'pending', 0, ?, ?, ?)`,
        )
        .run(input.proposedFileId, input.fileName, propertiesJson, input.now, input.now);
      return input.proposedFileId;
    });
    return claim.immediate();
  }

  /** 执行数据库组件对外暴露的操作。 */
  public registerMaterial(input: {
    readonly dossierId: ProjectDossierId;
    readonly fileId: string;
    readonly entityId: string;
    readonly fileName: string;
    readonly normalizedText: string;
    readonly parserVersion: string;
    readonly chunks: readonly ProjectMaterialChunkRecord[];
    readonly now: UtcInstant;
  }): { readonly material: ProjectMaterialRecord; readonly deduplicated: boolean } {
    z.uuid().parse(input.fileId);
    z.uuid().parse(input.entityId);
    materialFileNameSchema.parse(input.fileName);
    if (input.normalizedText.length < 1 || input.normalizedText.length > 512 * 1024) {
      throw new TypeError('Project material normalized text size is invalid.');
    }
    const metadataJson = JSON.stringify({ chunks: input.chunks });
    materialChunks(metadataJson, input.normalizedText);
    if (!input.parserVersion.trim()) throw new TypeError('Project material parser is required.');

    return this.#client.transaction(() => {
      const dossierExists = this.#client
        .prepare('SELECT 1 FROM project_dossiers WHERE id = ?')
        .get(input.dossierId);
      if (!dossierExists) throw new TypeError('Project material dossier does not exist.');

      const row = this.#client
        .prepare(`SELECT ${materialColumns} ${materialSource} AND file.id = ? AND entity.id = ?`)
        .get(input.fileId, input.entityId) as MaterialRow | undefined;
      if (row?.file_name !== input.fileName) {
        throw new TypeError('Project material file or entity does not match the upload.');
      }

      const rawProperties = parseJson(z.record(z.string(), z.unknown()), row.file_properties_json);
      if (Object.keys(rawProperties).length > 0) {
        const properties = materialPropertiesSchema.parse(rawProperties);
        if (properties.dossierId !== input.dossierId || properties.fileName !== input.fileName) {
          throw new TypeError('Project material logical file belongs to another dossier.');
        }
      }

      if (
        row.parser_version !== null ||
        row.parse_status !== null ||
        row.normalized_text !== null
      ) {
        if (
          row.parser_version !== input.parserVersion ||
          row.parse_status !== 'parsed' ||
          row.normalized_text !== input.normalizedText
        ) {
          throw new TypeError('Project material version is immutable once registered.');
        }
        // Concurrent imports of identical bytes produce the same physical mapping but may use
        // different generated chunk IDs. The first parsed metadata is authoritative.
        return { material: publicMaterialRecord(row), deduplicated: true };
      }

      const propertiesJson = JSON.stringify({
        dossierId: input.dossierId,
        fileName: input.fileName,
      });
      const fileChanged = this.#client
        .prepare(
          `UPDATE files SET state = 'stored', properties_json = ?, updated_at = ?
           WHERE id = ? AND kind = 'project_material' AND name = ?`,
        )
        .run(propertiesJson, input.now, input.fileId, input.fileName).changes;
      const mappingChanged = this.#client
        .prepare(
          `UPDATE file_entity_mappings
           SET parser_version = ?, parse_status = 'parsed', normalized_text = ?, metadata_json = ?
           WHERE file_id = ? AND entity_id = ?
             AND parser_version IS NULL AND parse_status IS NULL AND normalized_text IS NULL`,
        )
        .run(
          input.parserVersion,
          input.normalizedText,
          metadataJson,
          input.fileId,
          input.entityId,
        ).changes;
      if (fileChanged !== 1 || mappingChanged !== 1) {
        throw new TypeError('Project material version changed before registration.');
      }
      this.#bumpDossier(input.dossierId, input.now);
      const registered = this.#client
        .prepare(`SELECT ${materialColumns} ${materialSource} AND file.id = ? AND entity.id = ?`)
        .get(input.fileId, input.entityId) as MaterialRow | undefined;
      if (!registered) throw new TypeError('Registered project material is unavailable.');
      return { material: publicMaterialRecord(registered), deduplicated: false };
    })();
  }

  /** 执行数据库组件对外暴露的操作。 */
  public resolveMaterialBindings(
    dossierId: ProjectDossierId,
    fileIds: readonly string[],
  ): readonly ProjectMaterialBinding[] {
    if (new Set(fileIds).size !== fileIds.length) {
      throw new TypeError('Project material bindings contain duplicate files.');
    }
    return fileIds.flatMap((fileId) => {
      z.uuid().parse(fileId);
      const row = this.#client
        .prepare(
          `SELECT ${materialColumns} ${materialSource}
           AND file.id = ?
           AND json_valid(file.properties_json)
           AND json_extract(file.properties_json, '$.dossierId') = ?
           AND mapping.parser_version IS NOT NULL
           AND mapping.parse_status = 'parsed'
           AND mapping.normalized_text IS NOT NULL
           ORDER BY mapping.version_no DESC LIMIT 1`,
        )
        .get(fileId, dossierId) as MaterialRow | undefined;
      return row ? [bindingFromMaterial(publicMaterialRecord(row))] : [];
    });
  }

  /** 执行数据库组件对外暴露的操作。 */
  public createSession(input: {
    readonly session: DrillSessionRecord;
    readonly coverage: readonly DrillCoverageRecord[];
  }): DrillSessionRecord {
    return this.#client.transaction(() => {
      const value = input.session;
      const materialBindings = parseMaterialBindings(JSON.stringify(value.materialBindings));
      if (
        (value.profileKey === 'resume-only' && materialBindings.length !== 0) ||
        (value.profileKey === 'docs-grounded' && materialBindings.length === 0)
      ) {
        throw new TypeError('Drill session profile or material bindings are invalid.');
      }
      parseCapabilitySummary(value.profileKey, JSON.stringify(value.capabilitySummary));
      for (const binding of materialBindings) {
        const exact = this.#materialForBinding(value.dossierId, binding);
        if (!exact) {
          throw new TypeError('Project material binding is not available for this dossier.');
        }
      }
      this.#client
        .prepare(
          `INSERT INTO drill_sessions
           (id, dossier_id, profile_key, profile_version, profile_definition_hash,
            capability_summary_json, material_bindings_json, status, context_revision, created_at,
            updated_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          value.id,
          value.dossierId,
          value.profileKey,
          value.profileVersion,
          value.profileDefinitionHash,
          JSON.stringify(value.capabilitySummary),
          JSON.stringify(materialBindings),
          value.status,
          value.contextRevision,
          value.createdAt,
          value.updatedAt,
          value.completedAt,
        );
      const insertCoverage = this.#client.prepare(
        `INSERT INTO drill_coverage
         (session_id, dimension, status, evidence_item_ids_json, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      );
      for (const item of input.coverage) {
        insertCoverage.run(
          item.sessionId,
          item.dimension,
          item.status,
          JSON.stringify(item.evidenceItemIds),
          item.updatedAt,
        );
      }
      this.#bumpDossier(value.dossierId, value.createdAt);
      return value;
    })();
  }

  /** 执行数据库组件对外暴露的操作。 */
  public getSession(id: DrillSessionId): DrillSessionRecord | null {
    const row = this.#client
      .prepare(`SELECT ${sessionColumns} FROM drill_sessions WHERE id = ?`)
      .get(id) as SessionRow | undefined;
    return row ? sessionRecord(row) : null;
  }

  /** 执行数据库组件对外暴露的操作。 */
  public updateSessionStatus(input: {
    readonly id: DrillSessionId;
    readonly expectedStatus: DrillSessionRecord['status'];
    readonly status: DrillSessionRecord['status'];
    readonly now: UtcInstant;
  }): DrillSessionRecord | null {
    return this.#client.transaction(() => {
      const target = this.#client
        .prepare('SELECT dossier_id, status FROM drill_sessions WHERE id = ?')
        .get(input.id) as { dossier_id: string; status: string } | undefined;
      if (target?.status !== input.expectedStatus) return null;

      // 1、恢复目标会话前暂停同档案的当前会话；2、再以 CAS 激活目标，始终只保留一个 active。
      if (input.status === 'active') {
        this.#client
          .prepare(
            `UPDATE drill_sessions SET status = 'paused', updated_at = ?, completed_at = NULL,
               context_revision = context_revision + 1
             WHERE dossier_id = ? AND id <> ? AND status = 'active'`,
          )
          .run(input.now, target.dossier_id, input.id);
      }
      const result = this.#client
        .prepare(
          `UPDATE drill_sessions SET status = ?, updated_at = ?,
             completed_at = CASE WHEN ? = 'completed' THEN ? ELSE NULL END,
             context_revision = context_revision + 1
           WHERE id = ? AND status = ?`,
        )
        .run(input.status, input.now, input.status, input.now, input.id, input.expectedStatus);
      if (result.changes !== 1) throw new TypeError('Drill session changed during status update.');
      const session = this.getSession(input.id);
      if (!session) return null;
      this.#bumpDossier(session.dossierId, input.now);
      return session;
    })();
  }

  /** 执行数据库组件对外暴露的操作。 */
  public createQuestionTurn(input: {
    readonly turn: DrillTurnRecord;
    readonly expectedSessionRevision: number;
  }): DrillTurnRecord {
    return this.#client.transaction(() => {
      const session = this.#client
        .prepare('SELECT status, context_revision FROM drill_sessions WHERE id = ?')
        .get(input.turn.sessionId) as { status: string; context_revision: number } | undefined;
      if (
        session?.status !== 'active' ||
        session.context_revision !== input.expectedSessionRevision
      ) {
        throw new TypeError('Drill session changed before question creation.');
      }
      const value = input.turn;
      this.#client
        .prepare(
          `INSERT INTO drill_turns
           (id, session_id, turn_no, status, context_hash, question, intent, primary_dimension,
            guidance_slots_json, evidence_refs_json, question_task_id, question_agent_run_id,
            digest_task_id, digest_agent_run_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          value.id,
          value.sessionId,
          value.turnNo,
          value.status,
          value.contextHash,
          value.question,
          value.intent,
          value.primaryDimension,
          JSON.stringify(value.guidanceSlots),
          JSON.stringify(value.evidenceRefs),
          value.questionTaskId,
          value.questionAgentRunId,
          value.digestTaskId,
          value.digestAgentRunId,
          value.createdAt,
          value.updatedAt,
        );
      return value;
    })();
  }

  /** 执行数据库组件对外暴露的操作。 */
  public attachQuestionTask(input: {
    readonly turnId: DrillTurnId;
    readonly taskId: DrillTurnRecord['questionTaskId'] & string;
    readonly now: UtcInstant;
  }): void {
    const changed = this.#client
      .prepare(
        `UPDATE drill_turns SET question_task_id = ?, updated_at = ?
         WHERE id = ? AND status = 'question_pending' AND question_task_id IS NULL`,
      )
      .run(input.taskId, input.now, input.turnId).changes;
    if (changed === 1) return;
    const current = this.#client
      .prepare(
        `SELECT question_task_id FROM drill_turns
         WHERE id = ? AND status = 'question_pending'`,
      )
      .pluck()
      .get(input.turnId);
    if (current !== input.taskId) throw new TypeError('Question turn cannot attach this task.');
  }

  /** 执行数据库组件对外暴露的操作。 */
  public removeUnqueuedQuestionTurn(turnId: DrillTurnId): void {
    this.#client
      .prepare(
        `DELETE FROM drill_turns
         WHERE id = ? AND status = 'question_pending' AND question_task_id IS NULL`,
      )
      .run(turnId);
  }

  /** 执行数据库组件对外暴露的操作。 */
  public getQuestionContext(turnId: DrillTurnId): ProjectQuestionContext | null {
    const row = this.#client
      .prepare(`SELECT ${turnColumns} FROM drill_turns WHERE id = ?`)
      .get(turnId) as TurnRow | undefined;
    if (!row) return null;
    const turn = turnRecord(row);
    const session = this.getSession(turn.sessionId);
    if (!session) return null;
    const detail = this.getDossier(session.dossierId);
    if (!detail) return null;
    const history = detail.turns
      .filter((item) => item.turnNo < turn.turnNo && item.question !== null)
      .flatMap((item) => {
        const answer = detail.answers
          .filter((candidate) => candidate.turnId === item.id)
          .toSorted((left, right) => right.revisionNo - left.revisionNo)[0];
        return answer && item.question
          ? [
              {
                turnId: item.id,
                question: item.question,
                answerRevisionId: answer.id,
                answer: answer.answer,
              },
            ]
          : [];
      });
    const materials = session.materialBindings.map((binding) => {
      const material = this.#materialForBinding(session.dossierId, binding);
      if (!material) {
        throw new TypeError('Frozen project material binding is unavailable or invalid.');
      }
      return material;
    });
    return {
      dossier: detail.dossier,
      snapshot: detail.snapshot,
      session,
      turn,
      history,
      knowledgeItems: detail.knowledgeItems.filter((item) => item.status === 'active'),
      coverage: detail.coverage.filter((item) => item.sessionId === session.id),
      materials,
    };
  }

  /** 执行数据库组件对外暴露的操作。 */
  public completeQuestion(input: {
    readonly turnId: DrillTurnId;
    readonly expectedTaskId?: TaskId;
    readonly expectedContextHash: DrillTurnRecord['contextHash'];
    readonly expectedSessionRevision: number;
    readonly question: string;
    readonly intent: string;
    readonly primaryDimension: NonNullable<DrillTurnRecord['primaryDimension']>;
    readonly guidanceSlots: readonly string[];
    readonly evidenceRefs: DrillTurnRecord['evidenceRefs'];
    readonly agentRunId: NonNullable<DrillTurnRecord['questionAgentRunId']>;
    readonly now: UtcInstant;
  }): boolean {
    return this.#client.transaction(() => {
      const result = this.#client
        .prepare(
          `UPDATE drill_turns SET status = 'awaiting_answer', question = ?, intent = ?,
             primary_dimension = ?, guidance_slots_json = ?, evidence_refs_json = ?,
             question_agent_run_id = ?, updated_at = ?
           WHERE id = ? AND status = 'question_pending'
             AND context_hash = ?
             AND (
               (? IS NULL AND question_task_id IS NULL) OR (
                 question_task_id = ?
                 AND EXISTS (
                   SELECT 1 FROM tasks task
                   WHERE task.id = ? AND task.status = 'running'
                     AND task.cancel_requested_at IS NULL
                 )
               )
             )
             AND EXISTS (
               SELECT 1 FROM drill_sessions session
               WHERE session.id = drill_turns.session_id AND session.status = 'active'
                 AND session.context_revision = ?
             )`,
        )
        .run(
          input.question,
          input.intent,
          input.primaryDimension,
          JSON.stringify(input.guidanceSlots),
          JSON.stringify(input.evidenceRefs),
          input.agentRunId,
          input.now,
          input.turnId,
          input.expectedContextHash,
          input.expectedTaskId ?? null,
          input.expectedTaskId ?? null,
          input.expectedTaskId ?? null,
          input.expectedSessionRevision,
        );
      if (result.changes !== 1) return false;
      const sessionId = this.#client
        .prepare('SELECT session_id FROM drill_turns WHERE id = ?')
        .pluck()
        .get(input.turnId) as string;
      this.#client
        .prepare(
          `UPDATE drill_coverage SET status = CASE WHEN status = 'unasked' THEN 'asked' ELSE status END,
             updated_at = ? WHERE session_id = ? AND dimension = ?`,
        )
        .run(input.now, sessionId, input.primaryDimension);
      const dossierId = this.#client
        .prepare('SELECT dossier_id FROM drill_sessions WHERE id = ?')
        .pluck()
        .get(sessionId) as ProjectDossierId;
      this.#bumpDossier(dossierId, input.now);
      return true;
    })();
  }

  /** 执行数据库组件对外暴露的操作。 */
  public appendAnswer(input: {
    readonly sessionId: DrillSessionId;
    readonly turnId: DrillTurnId;
    readonly answer: DrillAnswerRevisionRecord;
    readonly expectedSessionRevision: number;
    readonly now: UtcInstant;
  }): { readonly answer: DrillAnswerRevisionRecord; readonly deduplicated: boolean } {
    return this.#client.transaction(() => {
      const existing = this.#client
        .prepare(
          `SELECT ${answerColumns} FROM drill_answer_revisions
           WHERE turn_id = ? AND idempotency_key = ?`,
        )
        .get(input.turnId, input.answer.idempotencyKey) as AnswerRow | undefined;
      if (existing) return { answer: answerRecord(existing), deduplicated: true };
      const session = this.getSession(input.sessionId);
      const turn = this.#client
        .prepare(`SELECT ${turnColumns} FROM drill_turns WHERE id = ? AND session_id = ?`)
        .get(input.turnId, input.sessionId) as TurnRow | undefined;
      if (
        session?.status !== 'active' ||
        session.contextRevision !== input.expectedSessionRevision ||
        !turn ||
        !['awaiting_answer', 'ready'].includes(turn.status)
      ) {
        throw new TypeError('Drill turn changed before answer submission.');
      }
      const latestTurnId = this.#client
        .prepare('SELECT id FROM drill_turns WHERE session_id = ? ORDER BY turn_no DESC LIMIT 1')
        .pluck()
        .get(input.sessionId);
      if (latestTurnId !== input.turnId)
        throw new TypeError('Only the latest turn can be revised.');
      const revisionNo = Number(
        this.#client
          .prepare(
            'SELECT COALESCE(MAX(revision_no), 0) + 1 FROM drill_answer_revisions WHERE turn_id = ?',
          )
          .pluck()
          .get(input.turnId),
      );
      const value = { ...input.answer, revisionNo };
      this.#client
        .prepare(
          `INSERT INTO drill_answer_revisions
           (id, turn_id, revision_no, answer_text, content_hash, idempotency_key, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          value.id,
          value.turnId,
          value.revisionNo,
          value.answer,
          value.contentHash,
          value.idempotencyKey,
          value.createdAt,
        );
      this.#client
        .prepare(
          `UPDATE drill_turns SET status = 'digest_pending', digest_task_id = NULL,
             digest_agent_run_id = NULL, updated_at = ? WHERE id = ?`,
        )
        .run(input.now, input.turnId);
      this.#client
        .prepare(
          'UPDATE drill_sessions SET context_revision = context_revision + 1, updated_at = ? WHERE id = ?',
        )
        .run(input.now, input.sessionId);
      this.#bumpDossier(session.dossierId, input.now);
      return { answer: value, deduplicated: false };
    })();
  }

  /** 执行数据库组件对外暴露的操作。 */
  public attachDigestTask(input: {
    readonly turnId: DrillTurnId;
    readonly taskId: DrillTurnRecord['digestTaskId'] & string;
    readonly now: UtcInstant;
  }): void {
    const changed = this.#client
      .prepare(
        `UPDATE drill_turns SET digest_task_id = ?, updated_at = ?
         WHERE id = ? AND status = 'digest_pending' AND digest_task_id IS NULL`,
      )
      .run(input.taskId, input.now, input.turnId).changes;
    if (changed === 1) return;
    const current = this.#client
      .prepare(
        `SELECT digest_task_id FROM drill_turns
         WHERE id = ? AND status = 'digest_pending'`,
      )
      .pluck()
      .get(input.turnId);
    if (current !== input.taskId) throw new TypeError('Answer turn cannot attach this task.');
  }

  /** 执行数据库组件对外暴露的操作。 */
  public getAnswerContext(
    turnId: DrillTurnId,
    answerRevisionId: DrillAnswerRevisionId,
  ): ProjectAnswerContext | null {
    const turnRow = this.#client
      .prepare(`SELECT ${turnColumns} FROM drill_turns WHERE id = ?`)
      .get(turnId) as TurnRow | undefined;
    const answerRow = this.#client
      .prepare(`SELECT ${answerColumns} FROM drill_answer_revisions WHERE id = ? AND turn_id = ?`)
      .get(answerRevisionId, turnId) as AnswerRow | undefined;
    if (!turnRow || !answerRow) return null;
    const turn = turnRecord(turnRow);
    const session = this.getSession(turn.sessionId);
    if (!session) return null;
    const detail = this.getDossier(session.dossierId);
    if (!detail) return null;
    return {
      dossier: detail.dossier,
      snapshot: detail.snapshot,
      session,
      turn,
      answerRevision: answerRecord(answerRow),
    };
  }

  /** 执行数据库组件对外暴露的操作。 */
  public completeAnswerDigest(input: {
    readonly turnId: DrillTurnId;
    readonly expectedTaskId?: TaskId;
    readonly answerRevisionId: DrillAnswerRevisionId;
    readonly expectedSessionRevision: number;
    readonly agentRunId: NonNullable<DrillTurnRecord['digestAgentRunId']>;
    readonly knowledgeItems: readonly ProjectKnowledgeItemRecord[];
    readonly coverage: readonly DrillCoverageRecord[];
    readonly now: UtcInstant;
  }): boolean {
    return this.#client.transaction(() => {
      const current = this.#client
        .prepare(
          `SELECT dt.session_id, ds.dossier_id,
             (SELECT id FROM drill_answer_revisions ar WHERE ar.turn_id = dt.id
              ORDER BY revision_no DESC LIMIT 1) AS latest_answer_id
           FROM drill_turns dt JOIN drill_sessions ds ON ds.id = dt.session_id
           WHERE dt.id = ? AND dt.status = 'digest_pending' AND dt.digest_task_id IS NOT NULL
             AND (
               ? IS NULL OR (
                 dt.digest_task_id = ?
                 AND EXISTS (
                   SELECT 1 FROM tasks task
                   WHERE task.id = ? AND task.status = 'running'
                     AND task.cancel_requested_at IS NULL
                 )
               )
             )
             AND ds.status = 'active' AND ds.context_revision = ?`,
        )
        .get(
          input.turnId,
          input.expectedTaskId ?? null,
          input.expectedTaskId ?? null,
          input.expectedTaskId ?? null,
          input.expectedSessionRevision,
        ) as { session_id: string; dossier_id: string; latest_answer_id: string } | undefined;
      if (current?.latest_answer_id !== input.answerRevisionId) return false;
      this.#client
        .prepare(
          `UPDATE project_knowledge_items SET status = 'superseded'
           WHERE source_answer_revision_id IN
             (SELECT id FROM drill_answer_revisions WHERE turn_id = ? AND id != ?)`,
        )
        .run(input.turnId, input.answerRevisionId);
      const insert = this.#client.prepare(
        `INSERT INTO project_knowledge_items
         (id, dossier_id, source_answer_revision_id, kind, statement, quote, source_start,
          source_end, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const item of input.knowledgeItems) {
        insert.run(
          item.id,
          item.dossierId,
          item.sourceAnswerRevisionId,
          item.kind,
          item.statement,
          item.quote,
          item.start,
          item.end,
          item.status,
          item.createdAt,
        );
      }
      const updateCoverage = this.#client.prepare(
        `UPDATE drill_coverage SET status = ?, evidence_item_ids_json = ?, updated_at = ?
         WHERE session_id = ? AND dimension = ?`,
      );
      for (const item of input.coverage) {
        updateCoverage.run(
          item.status,
          JSON.stringify(item.evidenceItemIds),
          item.updatedAt,
          item.sessionId,
          item.dimension,
        );
      }
      this.#client
        .prepare(
          `UPDATE drill_turns SET status = 'ready', digest_agent_run_id = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(input.agentRunId, input.now, input.turnId);
      this.#client
        .prepare(
          'UPDATE drill_sessions SET context_revision = context_revision + 1, updated_at = ? WHERE id = ?',
        )
        .run(input.now, current.session_id);
      this.#bumpDossier(parseId(current.dossier_id, 'ProjectDossier'), input.now);
      return true;
    })();
  }

  /** 执行数据库组件对外暴露的操作。 */
  public skipTurn(input: {
    readonly turnId: DrillTurnId;
    readonly now: UtcInstant;
  }): DrillTurnRecord {
    return this.#client.transaction(() => {
      const current = this.#client
        .prepare(
          `SELECT dt.session_id, ds.dossier_id FROM drill_turns dt
           JOIN drill_sessions ds ON ds.id = dt.session_id
           WHERE dt.id = ? AND dt.status = 'awaiting_answer' AND ds.status = 'active'`,
        )
        .get(input.turnId) as { session_id: string; dossier_id: string } | undefined;
      if (!current) throw new TypeError('Only the current unanswered turn can be skipped.');
      this.#client
        .prepare("UPDATE drill_turns SET status = 'skipped', updated_at = ? WHERE id = ?")
        .run(input.now, input.turnId);
      this.#client
        .prepare(
          'UPDATE drill_sessions SET context_revision = context_revision + 1, updated_at = ? WHERE id = ?',
        )
        .run(input.now, current.session_id);
      this.#bumpDossier(parseId(current.dossier_id, 'ProjectDossier'), input.now);
      const row = this.#client
        .prepare(`SELECT ${turnColumns} FROM drill_turns WHERE id = ?`)
        .get(input.turnId) as TurnRow;
      return turnRecord(row);
    })();
  }

  /** 执行数据库组件对外暴露的操作。 */
  public cancelPendingTurn(input: {
    readonly turnId: DrillTurnId;
    readonly now: UtcInstant;
  }): DrillTurnRecord {
    return this.#client.transaction(() => {
      const current = this.#client
        .prepare(
          `SELECT dt.session_id, ds.dossier_id FROM drill_turns dt
           JOIN drill_sessions ds ON ds.id = dt.session_id
           WHERE dt.id = ? AND dt.status IN ('question_pending', 'digest_pending')`,
        )
        .get(input.turnId) as { session_id: string; dossier_id: string } | undefined;
      if (!current) throw new TypeError('Only a pending drill turn can be cancelled.');
      this.#client
        .prepare("UPDATE drill_turns SET status = 'cancelled', updated_at = ? WHERE id = ?")
        .run(input.now, input.turnId);
      this.#client
        .prepare(
          'UPDATE drill_sessions SET context_revision = context_revision + 1, updated_at = ? WHERE id = ?',
        )
        .run(input.now, current.session_id);
      this.#bumpDossier(parseId(current.dossier_id, 'ProjectDossier'), input.now);
      const row = this.#client
        .prepare(`SELECT ${turnColumns} FROM drill_turns WHERE id = ?`)
        .get(input.turnId) as TurnRow;
      return turnRecord(row);
    })();
  }

  /** 执行数据库组件对外暴露的操作。 */
  public updateNotebook(input: {
    readonly dossierId: ProjectDossierId;
    readonly expectedRevision: number;
    readonly expectedTaskId?: TaskId;
    readonly artifactId: string;
    readonly sourceHash: ProjectDossierRecord['notebookSourceHash'] & string;
    readonly now: UtcInstant;
  }): boolean {
    return this.#client.transaction(() => {
      const previousArtifactId = this.#client
        .prepare('SELECT notebook_file_id FROM project_dossiers WHERE id = ?')
        .pluck()
        .get(input.dossierId) as string | null | undefined;
      const changed = this.#client
        .prepare(
          `UPDATE project_dossiers SET notebook_file_id = ?, notebook_source_hash = ?,
             updated_at = ? WHERE id = ? AND revision = ?
             AND (
               ? IS NULL OR EXISTS (
                 SELECT 1 FROM tasks task
                 WHERE task.id = ? AND task.task_type = 'interview.project-notebook.render'
                   AND task.status = 'running' AND task.cancel_requested_at IS NULL
                   AND task.lease_expires_at > ?
                   AND json_extract(task.payload_json, '$.dossierId') = ?
                   AND json_extract(task.payload_json, '$.sourceRevision') = ?
               )
             )`,
        )
        .run(
          input.artifactId,
          input.sourceHash,
          input.now,
          input.dossierId,
          input.expectedRevision,
          input.expectedTaskId ?? null,
          input.expectedTaskId ?? null,
          input.now,
          input.dossierId,
          input.expectedRevision,
        ).changes;
      if (changed !== 1) {
        this.#deleteUnreferencedNotebookFile(input.artifactId);
        return false;
      }
      if (previousArtifactId && previousArtifactId !== input.artifactId) {
        this.#deleteUnreferencedNotebookFile(previousArtifactId);
      }
      return true;
    })();
  }

  /** 执行数据库组件对外暴露的操作。 */
  public discardNotebookArtifact(artifactId: string): void {
    this.#client
      .transaction(() => {
        this.#deleteUnreferencedNotebookFile(artifactId);
      })
      .immediate();
  }

  /** 处理数据库类内部的辅助逻辑。 */
  #deleteUnreferencedNotebookFile(fileId: string): void {
    const entityIds = this.#client
      .prepare('SELECT entity_id FROM file_entity_mappings WHERE file_id = ?')
      .pluck()
      .all(fileId) as string[];
    const deleted = this.#client
      .prepare(
        `DELETE FROM files WHERE id = ? AND kind = 'project_notebook'
         AND NOT EXISTS (SELECT 1 FROM project_dossiers WHERE notebook_file_id = ?)`,
      )
      .run(fileId, fileId).changes;
    if (deleted !== 1) return;
    for (const entityId of entityIds) {
      this.#client
        .prepare(
          `DELETE FROM entities WHERE id = ?
           AND NOT EXISTS (SELECT 1 FROM file_entity_mappings WHERE entity_id = ?)`,
        )
        .run(entityId, entityId);
    }
  }

  /** 执行数据库组件对外暴露的操作。 */
  public previewDeletion(dossierId: ProjectDossierId): DossierDeletionSnapshot | null {
    const dossier = this.#client
      .prepare(
        `SELECT id, snapshot_id, revision,
                notebook_file_id AS latest_notebook_artifact_id
         FROM project_dossiers WHERE id = ?`,
      )
      .get(dossierId) as
      | {
          id: string;
          snapshot_id: string;
          revision: number;
          latest_notebook_artifact_id: string | null;
        }
      | undefined;
    if (!dossier) return null;
    const ids = (sql: string): string[] =>
      this.#client.prepare(sql).pluck().all(dossierId) as string[];
    const materialFileIds = this.#client
      .prepare(
        `SELECT id FROM files
         WHERE kind = 'project_material'
           AND json_valid(properties_json)
           AND json_extract(properties_json, '$.dossierId') = ?
         ORDER BY id`,
      )
      .pluck()
      .all(dossierId) as string[];
    const notebookFileShared = dossier.latest_notebook_artifact_id
      ? this.#client
          .prepare(
            `SELECT EXISTS(
               SELECT 1 FROM project_dossiers
               WHERE notebook_file_id = ? AND id != ?
             )`,
          )
          .pluck()
          .get(dossier.latest_notebook_artifact_id, dossierId) === 1
      : false;
    const deletionFileIds = [
      ...materialFileIds,
      ...(dossier.latest_notebook_artifact_id && !notebookFileShared
        ? [dossier.latest_notebook_artifact_id]
        : []),
    ];
    const deletionFileIdsJson = JSON.stringify(deletionFileIds);
    const notebook = dossier.latest_notebook_artifact_id
      ? (this.#client
          .prepare(
            `SELECT version.entity_id, entity.relative_path
             FROM file_entity_mappings version
             JOIN entities entity ON entity.id = version.entity_id
             WHERE version.file_id = ? AND entity.deleted_at IS NULL
             ORDER BY version.version_no DESC LIMIT 1`,
          )
          .get(dossier.latest_notebook_artifact_id) as
          { entity_id: string; relative_path: string } | undefined)
      : undefined;
    const notebookShared = notebook
      ? notebookFileShared ||
        this.#client
          .prepare(
            `SELECT EXISTS(
               SELECT 1 FROM file_entity_mappings
               WHERE entity_id = ?
                 AND file_id NOT IN (SELECT value FROM json_each(?))
             )`,
          )
          .pluck()
          .get(notebook.entity_id, deletionFileIdsJson) === 1
      : false;
    const materialArtifacts =
      materialFileIds.length === 0
        ? []
        : (this.#client
            .prepare(
              `SELECT DISTINCT entity.id, entity.relative_path,
                      EXISTS(
                        SELECT 1 FROM file_entity_mappings other
                        WHERE other.entity_id = entity.id
                          AND other.file_id NOT IN (SELECT value FROM json_each(?))
                      ) AS shared
               FROM file_entity_mappings mapping
               JOIN entities entity ON entity.id = mapping.entity_id
               WHERE mapping.file_id IN (SELECT value FROM json_each(?))
                 AND entity.deleted_at IS NULL
               ORDER BY entity.id`,
            )
            .all(deletionFileIdsJson, JSON.stringify(materialFileIds)) as {
            readonly id: string;
            readonly relative_path: string;
            readonly shared: 0 | 1;
          }[]);
    return {
      dossierId,
      dossierRevision: dossier.revision,
      snapshotId: parseId(dossier.snapshot_id, 'ResumeProjectSnapshot'),
      sessionIds: ids('SELECT id FROM drill_sessions WHERE dossier_id = ? ORDER BY id').map((id) =>
        parseId(id, 'DrillSession'),
      ),
      turnIds: ids(
        'SELECT dt.id FROM drill_turns dt JOIN drill_sessions ds ON ds.id = dt.session_id WHERE ds.dossier_id = ? ORDER BY dt.id',
      ).map((id) => parseId(id, 'DrillTurn')),
      answerRevisionIds: ids(
        `SELECT ar.id FROM drill_answer_revisions ar JOIN drill_turns dt ON dt.id = ar.turn_id
         JOIN drill_sessions ds ON ds.id = dt.session_id WHERE ds.dossier_id = ? ORDER BY ar.id`,
      ).map((id) => parseId(id, 'DrillAnswerRevision')),
      knowledgeItemIds: ids(
        'SELECT id FROM project_knowledge_items WHERE dossier_id = ? ORDER BY id',
      ).map((id) => parseId(id, 'ProjectKnowledgeItem')),
      notebookArtifactId: notebook?.entity_id ?? null,
      notebookRelativePath: notebook?.relative_path ?? null,
      notebookShared,
      materialFileIds,
      materialArtifacts: materialArtifacts.map((artifact) => ({
        id: artifact.id,
        relativePath: artifact.relative_path,
        shared: artifact.shared === 1,
      })),
    };
  }

  /** 执行数据库组件对外暴露的操作。 */
  public deleteDossier(input: {
    readonly expected: DossierDeletionSnapshot;
    readonly quarantinedArtifacts: readonly QuarantinedArtifact[];
    readonly deletedAt: UtcInstant;
  }): boolean {
    return this.#client.transaction(() => {
      const current = this.previewDeletion(input.expected.dossierId);
      if (!current || JSON.stringify(current) !== JSON.stringify(input.expected)) return false;
      const expectedArtifacts = new Map<string, string>();
      const addExpectedArtifact = (id: string, relativePath: string): void => {
        const existing = expectedArtifacts.get(id);
        if (existing !== undefined && existing !== relativePath) {
          throw new TypeError('Deletion impact contains inconsistent artifact paths.');
        }
        expectedArtifacts.set(id, relativePath);
      };
      if (current.notebookArtifactId && current.notebookRelativePath && !current.notebookShared) {
        addExpectedArtifact(current.notebookArtifactId, current.notebookRelativePath);
      }
      for (const artifact of current.materialArtifacts) {
        if (!artifact.shared) addExpectedArtifact(artifact.id, artifact.relativePath);
      }
      const quarantinedById = new Map(
        input.quarantinedArtifacts.map((artifact) => [artifact.artifactId, artifact]),
      );
      if (
        quarantinedById.size !== input.quarantinedArtifacts.length ||
        quarantinedById.size !== expectedArtifacts.size
      ) {
        throw new TypeError('Artifact quarantines do not match deletion impact.');
      }
      for (const [artifactId, relativePath] of expectedArtifacts) {
        if (quarantinedById.get(artifactId)?.originalRelativePath !== relativePath) {
          throw new TypeError('Artifact quarantines do not match deletion impact.');
        }
      }
      const notebookFileId = this.#client
        .prepare('SELECT notebook_file_id FROM project_dossiers WHERE id = ?')
        .pluck()
        .get(input.expected.dossierId) as string | null | undefined;
      this.#client
        .prepare('DELETE FROM project_dossiers WHERE id = ?')
        .run(input.expected.dossierId);
      this.#client
        .prepare('DELETE FROM resume_project_snapshots WHERE id = ?')
        .run(input.expected.snapshotId);
      if (current.materialFileIds.length > 0) {
        this.#client
          .prepare('DELETE FROM files WHERE id IN (SELECT value FROM json_each(?))')
          .run(JSON.stringify(current.materialFileIds));
      }
      if (notebookFileId) {
        this.#client
          .prepare(
            `DELETE FROM files WHERE id = ?
             AND NOT EXISTS (SELECT 1 FROM project_dossiers WHERE notebook_file_id = ?)`,
          )
          .run(notebookFileId, notebookFileId);
      }
      for (const [artifactId, relativePath] of expectedArtifacts) {
        const quarantined = quarantinedById.get(artifactId);
        if (!quarantined) throw new TypeError('Artifact quarantine is unavailable.');
        const changed = this.#client
          .prepare(
            `UPDATE entities SET relative_path = ?, deleted_at = ?
             WHERE id = ? AND relative_path = ? AND deleted_at IS NULL`,
          )
          .run(
            quarantined.quarantinedRelativePath,
            input.deletedAt,
            artifactId,
            relativePath,
          ).changes;
        if (changed !== 1) throw new TypeError('Artifact changed during dossier deletion.');
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
  #materialForBinding(
    dossierId: ProjectDossierId,
    binding: ProjectMaterialBinding,
  ): ProjectMaterialContext | null {
    const row = this.#client
      .prepare(
        `SELECT ${materialColumns} ${materialSource}
         AND file.id = ? AND mapping.version_no = ? AND entity.id = ?
         AND file.name = ? AND entity.sha256 = ?
         AND json_valid(file.properties_json)
         AND json_extract(file.properties_json, '$.dossierId') = ?
         AND json_extract(file.properties_json, '$.fileName') = ?
         AND mapping.parser_version IS NOT NULL
         AND mapping.parse_status = 'parsed'
         AND mapping.normalized_text IS NOT NULL`,
      )
      .get(
        binding.fileId,
        binding.versionNo,
        binding.entityId,
        binding.fileName,
        binding.contentHash,
        dossierId,
        binding.fileName,
      ) as MaterialRow | undefined;
    if (!row) return null;
    const material = materialRecord(row);
    return material.dossierId === dossierId ? material : null;
  }

  /** 处理数据库类内部的辅助逻辑。 */
  #bumpDossier(id: ProjectDossierId, now: UtcInstant): void {
    this.#client
      .prepare('UPDATE project_dossiers SET revision = revision + 1, updated_at = ? WHERE id = ?')
      .run(now, id);
  }
}
