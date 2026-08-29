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
  ProjectQuestionContext,
  QuarantinedArtifact,
  ResumeProjectSnapshotRecord,
} from '@jobhunter/application';
import {
  candidateProjectSchema,
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
  type UtcInstant,
} from '@jobhunter/domain';
import type Database from 'better-sqlite3';
import { z } from 'zod';

interface SnapshotRow {
  readonly id: string;
  readonly source_profile_id: string;
  readonly source_profile_version_id: string;
  readonly project_index: number;
  readonly project_json: string;
  readonly content_hash: string;
  readonly created_at: number;
}

interface DossierRow {
  readonly id: string;
  readonly snapshot_id: string;
  readonly latest_notebook_artifact_id: string | null;
  readonly notebook_source_hash: string | null;
  readonly revision: number;
  readonly created_at: number;
  readonly updated_at: number;
}

interface SessionRow {
  readonly id: string;
  readonly dossier_id: string;
  readonly profile_key: string;
  readonly profile_version: string;
  readonly profile_definition_hash: string;
  readonly capability_summary_json: string;
  readonly status: string;
  readonly context_revision: number;
  readonly created_at: number;
  readonly updated_at: number;
  readonly completed_at: number | null;
}

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

interface AnswerRow {
  readonly id: string;
  readonly turn_id: string;
  readonly revision_no: number;
  readonly answer_text: string;
  readonly content_hash: string;
  readonly idempotency_key: string;
  readonly created_at: number;
}

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

interface CoverageRow {
  readonly session_id: string;
  readonly dimension: string;
  readonly status: string;
  readonly evidence_item_ids_json: string;
  readonly updated_at: number;
}

const capabilitySummarySchema = z
  .object({
    evidenceKinds: z.tuple([
      z.literal('resume_project'),
      z.literal('user_answer'),
      z.literal('derived_claim'),
    ]),
    tools: z.tuple([]),
  })
  .strict();

function parseJson<T>(schema: z.ZodType<T>, value: string): T {
  return schema.parse(JSON.parse(value) as unknown);
}

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

function sessionRecord(row: SessionRow): DrillSessionRecord {
  if (row.profile_key !== 'resume-only' || row.profile_version !== 'v1') {
    throw new TypeError('Stored drill profile is unsupported.');
  }
  return {
    id: parseId(row.id, 'DrillSession'),
    dossierId: parseId(row.dossier_id, 'ProjectDossier'),
    profileKey: row.profile_key,
    profileVersion: row.profile_version,
    profileDefinitionHash: parseContentHash(row.profile_definition_hash),
    capabilitySummary: parseJson(capabilitySummarySchema, row.capability_summary_json),
    status: drillSessionStatusSchema.parse(row.status),
    contextRevision: row.context_revision,
    createdAt: row.created_at as UtcInstant,
    updatedAt: row.updated_at as UtcInstant,
    completedAt: row.completed_at as UtcInstant | null,
  };
}

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
const dossierColumns = `id, snapshot_id, latest_notebook_artifact_id, notebook_source_hash,
                        revision, created_at, updated_at`;
const sessionColumns = `id, dossier_id, profile_key, profile_version, profile_definition_hash,
                        capability_summary_json, status, context_revision, created_at, updated_at,
                        completed_at`;
const turnColumns = `id, session_id, turn_no, status, context_hash, question, intent,
                     primary_dimension, guidance_slots_json, evidence_refs_json, question_task_id,
                     question_agent_run_id, digest_task_id, digest_agent_run_id, created_at,
                     updated_at`;
const answerColumns = `id, turn_id, revision_no, answer_text, content_hash, idempotency_key,
                       created_at`;
const knowledgeColumns = `id, dossier_id, source_answer_revision_id, kind, statement, quote,
                          source_start, source_end, status, created_at`;
const coverageColumns = `session_id, dimension, status, evidence_item_ids_json, updated_at`;

export class SqliteInterviewProjectRepository implements InterviewProjectRepository {
  readonly #client: Database.Database;

  public constructor(client: Database.Database) {
    this.#client = client;
  }

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
           (id, snapshot_id, latest_notebook_artifact_id, notebook_source_hash, revision,
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
    };
  }

  public createSession(input: {
    readonly session: DrillSessionRecord;
    readonly coverage: readonly DrillCoverageRecord[];
  }): DrillSessionRecord {
    return this.#client.transaction(() => {
      const value = input.session;
      this.#client
        .prepare(
          `INSERT INTO drill_sessions
           (id, dossier_id, profile_key, profile_version, profile_definition_hash,
            capability_summary_json, status, context_revision, created_at, updated_at,
            completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          value.id,
          value.dossierId,
          value.profileKey,
          value.profileVersion,
          value.profileDefinitionHash,
          JSON.stringify(value.capabilitySummary),
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

  public getSession(id: DrillSessionId): DrillSessionRecord | null {
    const row = this.#client
      .prepare(`SELECT ${sessionColumns} FROM drill_sessions WHERE id = ?`)
      .get(id) as SessionRow | undefined;
    return row ? sessionRecord(row) : null;
  }

  public updateSessionStatus(input: {
    readonly id: DrillSessionId;
    readonly expectedStatus: DrillSessionRecord['status'];
    readonly status: DrillSessionRecord['status'];
    readonly now: UtcInstant;
  }): DrillSessionRecord | null {
    return this.#client.transaction(() => {
      const result = this.#client
        .prepare(
          `UPDATE drill_sessions SET status = ?, updated_at = ?,
             completed_at = CASE WHEN ? = 'completed' THEN ? ELSE NULL END,
             context_revision = context_revision + 1
           WHERE id = ? AND status = ?`,
        )
        .run(input.status, input.now, input.status, input.now, input.id, input.expectedStatus);
      if (result.changes !== 1) return null;
      const session = this.getSession(input.id);
      if (!session) return null;
      this.#bumpDossier(session.dossierId, input.now);
      return session;
    })();
  }

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
    if (changed !== 1) throw new TypeError('Question turn cannot attach this task.');
  }

  public removeUnqueuedQuestionTurn(turnId: DrillTurnId): void {
    this.#client
      .prepare(
        `DELETE FROM drill_turns
         WHERE id = ? AND status = 'question_pending' AND question_task_id IS NULL`,
      )
      .run(turnId);
  }

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
    return {
      dossier: detail.dossier,
      snapshot: detail.snapshot,
      session,
      turn,
      history,
      knowledgeItems: detail.knowledgeItems.filter((item) => item.status === 'active'),
      coverage: detail.coverage.filter((item) => item.sessionId === session.id),
    };
  }

  public completeQuestion(input: {
    readonly turnId: DrillTurnId;
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
           WHERE id = ? AND status = 'question_pending' AND question_task_id IS NOT NULL
             AND context_hash = ?
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
    if (changed !== 1) throw new TypeError('Answer turn cannot attach this task.');
  }

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

  public completeAnswerDigest(input: {
    readonly turnId: DrillTurnId;
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
             AND ds.status = 'active' AND ds.context_revision = ?`,
        )
        .get(input.turnId, input.expectedSessionRevision) as
        { session_id: string; dossier_id: string; latest_answer_id: string } | undefined;
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

  public updateNotebook(input: {
    readonly dossierId: ProjectDossierId;
    readonly expectedRevision: number;
    readonly artifactId: string;
    readonly sourceHash: ProjectDossierRecord['notebookSourceHash'] & string;
    readonly now: UtcInstant;
  }): boolean {
    return this.#client.transaction(() => {
      const previousArtifactId = this.#client
        .prepare('SELECT latest_notebook_artifact_id FROM project_dossiers WHERE id = ?')
        .pluck()
        .get(input.dossierId) as string | null | undefined;
      const changed = this.#client
        .prepare(
          `UPDATE project_dossiers SET latest_notebook_artifact_id = ?, notebook_source_hash = ?,
             updated_at = ? WHERE id = ? AND revision = ?`,
        )
        .run(
          input.artifactId,
          input.sourceHash,
          input.now,
          input.dossierId,
          input.expectedRevision,
        ).changes;
      if (changed !== 1) return false;
      if (previousArtifactId && previousArtifactId !== input.artifactId) {
        this.#client
          .prepare(
            `DELETE FROM file_artifacts WHERE id = ?
             AND NOT EXISTS (
               SELECT 1 FROM project_dossiers value
               WHERE value.latest_notebook_artifact_id = file_artifacts.id
             )
             AND NOT EXISTS (
               SELECT 1 FROM raw_job_records value WHERE value.artifact_id = file_artifacts.id
             )
             AND NOT EXISTS (
               SELECT 1 FROM resume_documents value WHERE value.artifact_id = file_artifacts.id
             )`,
          )
          .run(previousArtifactId);
      }
      return true;
    })();
  }

  public previewDeletion(dossierId: ProjectDossierId): DossierDeletionSnapshot | null {
    const dossier = this.#client
      .prepare(
        'SELECT id, snapshot_id, revision, latest_notebook_artifact_id FROM project_dossiers WHERE id = ?',
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
    const notebook = dossier.latest_notebook_artifact_id
      ? (this.#client
          .prepare('SELECT relative_path FROM file_artifacts WHERE id = ?')
          .get(dossier.latest_notebook_artifact_id) as { relative_path: string } | undefined)
      : undefined;
    const notebookShared = dossier.latest_notebook_artifact_id
      ? this.#client
          .prepare(
            `SELECT
               EXISTS(
                 SELECT 1 FROM project_dossiers
                 WHERE latest_notebook_artifact_id = ? AND id != ?
               ) OR EXISTS(
                 SELECT 1 FROM raw_job_records WHERE artifact_id = ?
               ) OR EXISTS(
                 SELECT 1 FROM resume_documents WHERE artifact_id = ?
               )`,
          )
          .pluck()
          .get(
            dossier.latest_notebook_artifact_id,
            dossierId,
            dossier.latest_notebook_artifact_id,
            dossier.latest_notebook_artifact_id,
          ) === 1
      : false;
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
      notebookArtifactId: dossier.latest_notebook_artifact_id,
      notebookRelativePath: notebook?.relative_path ?? null,
      notebookShared,
    };
  }

  public deleteDossier(input: {
    readonly expected: DossierDeletionSnapshot;
    readonly quarantinedArtifact: QuarantinedArtifact | null;
    readonly deletedAt: UtcInstant;
  }): boolean {
    return this.#client.transaction(() => {
      const current = this.previewDeletion(input.expected.dossierId);
      if (!current || JSON.stringify(current) !== JSON.stringify(input.expected)) return false;
      const requiresQuarantine = Boolean(
        input.expected.notebookArtifactId &&
        input.expected.notebookRelativePath &&
        !input.expected.notebookShared,
      );
      if (
        requiresQuarantine !== Boolean(input.quarantinedArtifact) ||
        (input.quarantinedArtifact &&
          (input.quarantinedArtifact.artifactId !== input.expected.notebookArtifactId ||
            input.quarantinedArtifact.originalRelativePath !== input.expected.notebookRelativePath))
      ) {
        throw new TypeError('Notebook quarantine does not match deletion impact.');
      }
      this.#client
        .prepare('DELETE FROM project_dossiers WHERE id = ?')
        .run(input.expected.dossierId);
      this.#client
        .prepare('DELETE FROM resume_project_snapshots WHERE id = ?')
        .run(input.expected.snapshotId);
      if (input.quarantinedArtifact) {
        this.#client
          .prepare(
            `UPDATE file_artifacts SET relative_path = ?, deleted_at = ?
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

  public removePurgedNotebookArtifact(artifactId: string): void {
    this.#client
      .prepare(
        `DELETE FROM file_artifacts WHERE id = ? AND deleted_at IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM project_dossiers WHERE latest_notebook_artifact_id = ?)`,
      )
      .run(artifactId, artifactId);
  }

  #bumpDossier(id: ProjectDossierId, now: UtcInstant): void {
    this.#client
      .prepare('UPDATE project_dossiers SET revision = revision + 1, updated_at = ? WHERE id = ?')
      .run(now, id);
  }
}
