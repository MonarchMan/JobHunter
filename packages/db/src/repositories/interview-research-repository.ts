import type {
  CommunityExperienceFilter,
  CommunityExperienceSummary,
  CommunityInterviewExperienceRecord,
  CommunityInterviewQuestionRecord,
  ExperienceResearchDetail,
  ExperienceResearchRequestRecord,
  InterviewResearchRepository,
} from '@jobhunter/application';
import {
  experienceResearchBriefSchema,
  normalizePublicResearchUrl,
  parseContentHash,
  parseId,
  type ExperienceResearchRequestId,
  type InterviewExperienceId,
  type TaskId,
  type UtcInstant,
} from '@jobhunter/domain';
import type Database from 'better-sqlite3';
import { z } from 'zod';

/** 数据库查询结果对应的行结构。 */
interface RequestRow {
  readonly id: string;
  readonly brief_json: string;
  readonly request_fingerprint: string;
  readonly prompt_version: string;
  readonly schema_version: string;
  readonly prompt_file_id: string;
  readonly prompt_file_version_no: number;
  readonly schema_file_id: string;
  readonly schema_file_version_no: number;
  readonly bundle_file_id: string | null;
  readonly bundle_file_version_no: number | null;
  readonly current_task_id: string | null;
  readonly state: string;
  readonly revision: number;
  readonly created_at: number;
  readonly updated_at: number;
}

/** 数据库查询结果对应的行结构。 */
interface CommunityExperienceRow {
  readonly id: string;
  readonly file_id: string;
  readonly sequence_no: number;
  readonly research_request_id: string;
  readonly review_status: string;
  readonly company: string | null;
  readonly role: string | null;
  readonly stage: string | null;
  readonly occurred_on: string | null;
  readonly tags_json: string;
  readonly notes: string | null;
  readonly source_url: string;
  readonly source_title: string;
  readonly source_published_at: string | null;
  readonly source_retrieved_at: string;
  readonly verification_status: string;
}

/** 数据库查询结果对应的行结构。 */
interface CommunityQuestionRow {
  readonly id: string;
  readonly experience_id: string;
  readonly sequence_no: number;
  readonly question: string;
  readonly answer_excerpt: string | null;
  readonly topics_json: string;
  readonly evidence_excerpt: string;
  readonly question_fingerprint: string;
}

const requestColumns = `id, brief_json, request_fingerprint, prompt_version, schema_version,
  prompt_file_id, prompt_file_version_no, schema_file_id, schema_file_version_no, bundle_file_id,
  bundle_file_version_no, current_task_id, state, revision, created_at, updated_at`;
const experienceColumns = `id, file_id, sequence_no, research_request_id, review_status, company,
  role, stage, occurred_on, tags_json, notes, source_url, source_title, source_published_at,
  source_retrieved_at, verification_status`;
const questionColumns = `id, experience_id, sequence_no, question, answer_excerpt, topics_json,
  evidence_excerpt, question_fingerprint`;
const researchFilePropertiesSchema = z
  .object({ warnings: z.array(z.string().max(500)).max(50).optional() })
  .loose();

/** 执行数据库结果的解析、转换或持久化辅助逻辑。 */
function json<T>(value: string, schema: z.ZodType<T>): T {
  return schema.parse(JSON.parse(value) as unknown);
}

/** 执行数据库结果的解析、转换或持久化辅助逻辑。 */
function requestRecord(row: RequestRow): ExperienceResearchRequestRecord {
  if (!['ready', 'needs_review', 'completed'].includes(row.state)) {
    throw new TypeError('Stored research request state is invalid.');
  }
  return {
    id: parseId(row.id, 'ExperienceResearchRequest'),
    brief: json(row.brief_json, experienceResearchBriefSchema),
    requestFingerprint: parseContentHash(row.request_fingerprint),
    promptVersion: row.prompt_version,
    schemaVersion: row.schema_version,
    promptFileId: row.prompt_file_id,
    promptFileVersionNo: row.prompt_file_version_no,
    schemaFileId: row.schema_file_id,
    schemaFileVersionNo: row.schema_file_version_no,
    bundleFileId: row.bundle_file_id,
    bundleFileVersionNo: row.bundle_file_version_no,
    currentTaskId: row.current_task_id === null ? null : parseId(row.current_task_id, 'Task'),
    state: row.state as ExperienceResearchRequestRecord['state'],
    revision: row.revision,
    createdAt: row.created_at as UtcInstant,
    updatedAt: row.updated_at as UtcInstant,
  };
}

/** 执行数据库结果的解析、转换或持久化辅助逻辑。 */
function experienceRecord(row: CommunityExperienceRow): CommunityInterviewExperienceRecord {
  if (
    !['needs_review', 'accepted', 'rejected'].includes(row.review_status) ||
    row.verification_status !== 'unverified'
  ) {
    throw new TypeError('Stored community experience state is invalid.');
  }
  return {
    id: parseId(row.id, 'InterviewExperience'),
    fileId: row.file_id,
    sequenceNo: row.sequence_no,
    researchRequestId: parseId(row.research_request_id, 'ExperienceResearchRequest'),
    reviewStatus: row.review_status as CommunityInterviewExperienceRecord['reviewStatus'],
    company: row.company,
    role: row.role,
    stage: row.stage,
    occurredOn: row.occurred_on === null ? null : z.iso.date().parse(row.occurred_on),
    tags: json(row.tags_json, z.array(z.string())),
    notes: row.notes,
    sourceUrl: normalizePublicResearchUrl(row.source_url),
    sourceTitle: row.source_title,
    sourcePublishedAt:
      row.source_published_at === null ? null : z.iso.datetime().parse(row.source_published_at),
    sourceRetrievedAt: z.iso.datetime().parse(row.source_retrieved_at),
    verificationStatus: 'unverified',
  };
}

/** 执行数据库结果的解析、转换或持久化辅助逻辑。 */
function questionRecord(row: CommunityQuestionRow): CommunityInterviewQuestionRecord {
  return {
    id: parseId(row.id, 'InterviewQuestionEntry'),
    experienceId: parseId(row.experience_id, 'InterviewExperience'),
    sequenceNo: row.sequence_no,
    question: row.question,
    answerExcerpt: row.answer_excerpt,
    topics: json(row.topics_json, z.array(z.string())),
    evidenceExcerpt: row.evidence_excerpt,
    questionFingerprint: parseContentHash(row.question_fingerprint),
  };
}

/** 持久化网友面经研究请求、来源、候选问题和审核状态。 */
export class SqliteInterviewResearchRepository implements InterviewResearchRepository {
  readonly #client: Database.Database;

  public constructor(client: Database.Database) {
    this.#client = client;
  }

  /** 执行数据库组件对外暴露的操作。 */
  public findByFingerprint(
    fingerprint: ExperienceResearchRequestRecord['requestFingerprint'],
  ): ExperienceResearchDetail | null {
    const id = this.#client
      .prepare('SELECT id FROM experience_research_requests WHERE request_fingerprint = ?')
      .pluck()
      .get(fingerprint) as string | undefined;
    return id ? this.getRequest(parseId(id, 'ExperienceResearchRequest')) : null;
  }

  /** 执行数据库组件对外暴露的操作。 */
  public createRequest(request: ExperienceResearchRequestRecord): ExperienceResearchDetail {
    return this.#client
      .transaction(() => {
        const inserted = this.#client
          .prepare(
            `INSERT INTO experience_research_requests
           (${requestColumns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(request_fingerprint) DO NOTHING`,
          )
          .run(
            request.id,
            JSON.stringify(request.brief),
            request.requestFingerprint,
            request.promptVersion,
            request.schemaVersion,
            request.promptFileId,
            request.promptFileVersionNo,
            request.schemaFileId,
            request.schemaFileVersionNo,
            request.bundleFileId,
            request.bundleFileVersionNo,
            request.currentTaskId,
            request.state,
            request.revision,
            request.createdAt,
            request.updatedAt,
          );
        const storedId = this.#client
          .prepare('SELECT id FROM experience_research_requests WHERE request_fingerprint = ?')
          .pluck()
          .get(request.requestFingerprint) as string | undefined;
        if (!storedId) throw new TypeError('Research request insertion did not produce a row.');
        const storedRequestId = parseId(storedId, 'ExperienceResearchRequest');
        const mark = this.#client.prepare(
          `UPDATE files SET properties_json = json_set(properties_json,
           '$.researchRequestId', ?, '$.assetType', ?), updated_at = ? WHERE id = ?`,
        );
        if (inserted.changes === 1) {
          mark.run(request.id, 'prompt', request.updatedAt, request.promptFileId);
          mark.run(request.id, 'schema', request.updatedAt, request.schemaFileId);
        }
        const detail = this.getRequest(storedRequestId);
        if (!detail) throw new TypeError('Created research request is unavailable.');
        return detail;
      })
      .immediate();
  }

  /** 执行数据库组件对外暴露的操作。 */
  public listRequests(): readonly ExperienceResearchRequestRecord[] {
    return (
      this.#client
        .prepare(
          `SELECT ${requestColumns} FROM experience_research_requests ORDER BY updated_at DESC, id`,
        )
        .all() as RequestRow[]
    ).map(requestRecord);
  }

  /** 执行数据库组件对外暴露的操作。 */
  public getRequest(id: ExperienceResearchRequestId): ExperienceResearchDetail | null {
    const request = this.#client
      .prepare(`SELECT ${requestColumns} FROM experience_research_requests WHERE id = ?`)
      .get(id) as RequestRow | undefined;
    if (!request) return null;
    const experiences = (
      this.#client
        .prepare(
          `SELECT ${experienceColumns} FROM interview_experiences
           WHERE research_request_id = ? AND source_type = 'community' ORDER BY sequence_no, id`,
        )
        .all(id) as CommunityExperienceRow[]
    ).map(experienceRecord);
    const questions = (
      this.#client
        .prepare(
          `SELECT ${questionColumns} FROM interview_question_entries
           WHERE experience_id IN (
             SELECT id FROM interview_experiences WHERE research_request_id = ?
           ) ORDER BY experience_id, sequence_no`,
        )
        .all(id) as CommunityQuestionRow[]
    ).map(questionRecord);
    const warnings = request.bundle_file_id
      ? (() => {
          const properties = this.#client
            .prepare('SELECT properties_json FROM files WHERE id = ?')
            .pluck()
            .get(request.bundle_file_id) as string | undefined;
          if (properties === undefined) throw new TypeError('Research bundle file is unavailable.');
          return (
            researchFilePropertiesSchema.parse(JSON.parse(properties) as unknown).warnings ?? []
          );
        })()
      : [];
    return {
      request: requestRecord(request),
      experiences,
      questions,
      warnings,
      occurrenceCounts: this.#occurrenceCounts('e.research_request_id = ?', [id]),
    };
  }

  /** 执行数据库组件对外暴露的操作。 */
  public attachTask(input: {
    readonly requestId: ExperienceResearchRequestId;
    readonly expectedRevision: number;
    readonly taskId: ExperienceResearchRequestRecord['currentTaskId'] & string;
    readonly now: UtcInstant;
  }): boolean {
    const changed = this.#client
      .prepare(
        `UPDATE experience_research_requests
           SET current_task_id = ?, state = 'ready', updated_at = ?
           WHERE id = ? AND revision = ? AND bundle_import_token IS NULL
             AND (
               state = 'ready'
               OR (
                 state = 'completed'
                 AND coalesce(bundle_file_version_no, 0) < 5
                 AND EXISTS (
                   SELECT 1 FROM interview_experiences e
                   WHERE e.research_request_id = experience_research_requests.id
                     AND e.source_type = 'community'
                 )
                 AND NOT EXISTS (
                   SELECT 1 FROM interview_experiences e
                   WHERE e.research_request_id = experience_research_requests.id
                     AND e.source_type = 'community' AND e.review_status <> 'rejected'
                 )
               )
             )`,
      )
      .run(input.taskId, input.now, input.requestId, input.expectedRevision).changes;
    if (changed === 1) return true;
    return (
      this.#client
        .prepare(
          `SELECT 1 FROM experience_research_requests
           WHERE id = ? AND revision = ? AND current_task_id = ?
             AND bundle_import_token IS NULL
             AND (
               state = 'ready'
               OR (
                 state = 'completed'
                 AND coalesce(bundle_file_version_no, 0) < 5
                 AND EXISTS (
                   SELECT 1 FROM interview_experiences e
                   WHERE e.research_request_id = experience_research_requests.id
                     AND e.source_type = 'community'
                 )
                 AND NOT EXISTS (
                   SELECT 1 FROM interview_experiences e
                   WHERE e.research_request_id = experience_research_requests.id
                     AND e.source_type = 'community' AND e.review_status <> 'rejected'
                 )
               )
             )`,
        )
        .pluck()
        .get(input.requestId, input.expectedRevision, input.taskId) === 1
    );
  }

  /** 执行数据库组件对外暴露的操作。 */
  public claimBundleImport(input: {
    readonly requestId: ExperienceResearchRequestId;
    readonly expectedRevision: number;
    readonly taskId?: TaskId;
    readonly claimToken: string;
    readonly stagingFileId: string;
    readonly now: UtcInstant;
    readonly staleBefore: UtcInstant;
  }): boolean {
    return this.#client
      .transaction(() => {
        const request = this.#client
          .prepare(
            `SELECT revision, bundle_file_id, bundle_file_version_no, bundle_import_token,
                  bundle_import_claimed_at, bundle_import_file_id, current_task_id
           FROM experience_research_requests WHERE id = ?`,
          )
          .get(input.requestId) as
          | {
              readonly revision: number;
              readonly bundle_file_id: string | null;
              readonly bundle_file_version_no: number | null;
              readonly bundle_import_token: string | null;
              readonly bundle_import_claimed_at: number | null;
              readonly bundle_import_file_id: string | null;
              readonly current_task_id: string | null;
            }
          | undefined;
        if (
          request?.revision !== input.expectedRevision ||
          (request.bundle_file_version_no ?? 0) >= 5 ||
          (request.bundle_import_token !== null &&
            (request.bundle_import_claimed_at === null ||
              request.bundle_import_claimed_at > input.staleBefore))
        ) {
          return false;
        }
        if (
          input.taskId !== undefined &&
          !this.#taskMayPublish(input.taskId, request.current_task_id)
        ) {
          return false;
        }
        const accepted = Number(
          this.#client
            .prepare(
              `SELECT count(*) FROM interview_experiences
             WHERE research_request_id = ? AND review_status = 'accepted'`,
            )
            .pluck()
            .get(input.requestId),
        );
        if (accepted > 0) return false;

        const changed = this.#client
          .prepare(
            `UPDATE experience_research_requests
           SET bundle_import_token = ?, bundle_import_claimed_at = ?, bundle_import_file_id = ?
           WHERE id = ? AND revision = ?
             AND (bundle_import_token IS NULL OR bundle_import_claimed_at <= ?)`,
          )
          .run(
            input.claimToken,
            input.now,
            input.stagingFileId,
            input.requestId,
            input.expectedRevision,
            input.staleBefore,
          ).changes;
        if (changed !== 1) return false;

        if (
          request.bundle_import_file_id !== null &&
          request.bundle_import_file_id !== input.stagingFileId
        ) {
          this.#deleteUnreferencedStagingFile(request.bundle_import_file_id);
        }
        if (request.bundle_file_id !== null) {
          this.#deleteUncommittedFileVersions(
            request.bundle_file_id,
            request.bundle_file_version_no ?? 0,
          );
        }
        return true;
      })
      .immediate();
  }

  /** 执行数据库组件对外暴露的操作。 */
  public replaceCandidates(input: {
    readonly requestId: ExperienceResearchRequestId;
    readonly expectedRevision: number;
    readonly taskId?: TaskId;
    readonly claimToken: string;
    readonly bundleFileId: string;
    readonly stagingFileId: string;
    readonly stagingFileVersionNo: number;
    readonly stagingEntityId: string;
    readonly experiences: readonly CommunityInterviewExperienceRecord[];
    readonly questions: readonly CommunityInterviewQuestionRecord[];
    readonly warnings: readonly string[];
    readonly now: UtcInstant;
  }): ExperienceResearchDetail | null {
    return this.#client
      .transaction(() => {
        const state = this.#client
          .prepare(
            `SELECT state, revision, bundle_file_id, bundle_file_version_no, bundle_import_token,
                  bundle_import_file_id, current_task_id
           FROM experience_research_requests WHERE id = ?`,
          )
          .get(input.requestId) as
          | {
              readonly state: string;
              readonly revision: number;
              readonly bundle_file_id: string | null;
              readonly bundle_file_version_no: number | null;
              readonly bundle_import_token: string | null;
              readonly bundle_import_file_id: string | null;
              readonly current_task_id: string | null;
            }
          | undefined;
        const accepted = Number(
          this.#client
            .prepare(
              `SELECT count(*) FROM interview_experiences
             WHERE research_request_id = ? AND review_status = 'accepted'`,
            )
            .pluck()
            .get(input.requestId),
        );
        if (
          state?.revision !== input.expectedRevision ||
          state.bundle_import_token !== input.claimToken ||
          state.bundle_import_file_id !== input.stagingFileId ||
          (state.bundle_file_id !== null && state.bundle_file_id !== input.bundleFileId) ||
          (state.bundle_file_version_no ?? 0) >= 5 ||
          (input.taskId !== undefined &&
            !this.#taskMayPublish(input.taskId, state.current_task_id)) ||
          accepted > 0 ||
          input.experiences.some(
            (experience) =>
              experience.researchRequestId !== input.requestId ||
              experience.fileId !== input.bundleFileId,
          )
        ) {
          return null;
        }
        const stagedEntityId = this.#client
          .prepare(
            `SELECT mapping.entity_id
           FROM file_entity_mappings mapping
           JOIN files file ON file.id = mapping.file_id
           WHERE mapping.file_id = ? AND mapping.version_no = ? AND mapping.entity_id = ?
             AND file.kind = 'interview_research'`,
          )
          .pluck()
          .get(input.stagingFileId, input.stagingFileVersionNo, input.stagingEntityId) as
          string | undefined;
        if (!stagedEntityId) return null;

        const existingBundleFile = this.#client
          .prepare('SELECT kind FROM files WHERE id = ?')
          .get(input.bundleFileId) as { readonly kind: string } | undefined;
        if (existingBundleFile && existingBundleFile.kind !== 'interview_research') return null;
        const existingBundleVersion = this.#client
          .prepare(
            `SELECT version_no FROM file_entity_mappings
           WHERE file_id = ? AND entity_id = ?`,
          )
          .pluck()
          .get(input.bundleFileId, stagedEntityId) as number | undefined;
        const nextBundleVersion =
          existingBundleVersion ??
          Number(
            this.#client
              .prepare(
                `SELECT COALESCE(MAX(version_no), 0) + 1
               FROM file_entity_mappings WHERE file_id = ?`,
              )
              .pluck()
              .get(input.bundleFileId),
          );
        if (nextBundleVersion < 1 || nextBundleVersion > 5) return null;

        this.#client
          .prepare(
            `INSERT INTO files
           (id, kind, name, state, revision, properties_json, created_at, updated_at)
           VALUES (?, 'interview_research', ?, 'stored', 0, '{}', ?, ?)
           ON CONFLICT(id) DO NOTHING`,
          )
          .run(input.bundleFileId, `${input.requestId}-bundle.json`, input.now, input.now);
        if (existingBundleVersion === undefined) {
          this.#client
            .prepare(
              `INSERT INTO file_entity_mappings
             (file_id, entity_id, version_no, metadata_json, created_at)
             VALUES (?, ?, ?, '{}', ?)`,
            )
            .run(input.bundleFileId, stagedEntityId, nextBundleVersion, input.now);
        }
        this.#client
          .prepare('DELETE FROM interview_experiences WHERE research_request_id = ?')
          .run(input.requestId);
        const insertExperience = this.#client.prepare(
          `INSERT INTO interview_experiences
         (id, file_id, sequence_no, source_type, review_status, research_request_id, company, role,
          stage, occurred_on, outcome, difficulty, tags_json, notes, source_url, source_title,
          source_published_at, source_retrieved_at, verification_status)
         VALUES (?, ?, ?, 'community', ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const experience of input.experiences) {
          insertExperience.run(
            experience.id,
            experience.fileId,
            experience.sequenceNo,
            experience.reviewStatus,
            experience.researchRequestId,
            experience.company,
            experience.role,
            experience.stage,
            experience.occurredOn,
            JSON.stringify(experience.tags),
            experience.notes,
            experience.sourceUrl,
            experience.sourceTitle,
            experience.sourcePublishedAt,
            experience.sourceRetrievedAt,
            experience.verificationStatus,
          );
        }
        const insertQuestion = this.#client.prepare(
          `INSERT INTO interview_question_entries
         (id, experience_id, sequence_no, question, answer, reflection, answer_excerpt, topics_json,
          evidence_excerpt, question_fingerprint, question_source_start, question_source_end,
          answer_source_start, answer_source_end)
         VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, NULL, NULL, NULL, NULL)`,
        );
        for (const question of input.questions) {
          insertQuestion.run(
            question.id,
            question.experienceId,
            question.sequenceNo,
            question.question,
            question.answerExcerpt,
            JSON.stringify(question.topics),
            question.evidenceExcerpt,
            question.questionFingerprint,
          );
        }
        const changed = this.#client
          .prepare(
            `UPDATE experience_research_requests
           SET bundle_file_id = ?, bundle_file_version_no = ?,
               bundle_import_token = NULL, bundle_import_claimed_at = NULL,
               bundle_import_file_id = NULL, state = 'needs_review',
               revision = revision + 1, updated_at = ?
           WHERE id = ? AND revision = ? AND bundle_import_token = ?`,
          )
          .run(
            input.bundleFileId,
            nextBundleVersion,
            input.now,
            input.requestId,
            input.expectedRevision,
            input.claimToken,
          ).changes;
        if (changed !== 1) return null;
        this.#client
          .prepare(
            `UPDATE files SET state = 'needs_review',
             properties_json = json_set(properties_json,
               '$.researchRequestId', ?, '$.assetType', 'bundle', '$.warnings', json(?)),
             updated_at = ? WHERE id = ?`,
          )
          .run(input.requestId, JSON.stringify(input.warnings), input.now, input.bundleFileId);
        this.#deleteUnreferencedStagingFile(input.stagingFileId);
        return this.getRequest(input.requestId);
      })
      .immediate();
  }

  /** 执行数据库组件对外暴露的操作。 */
  public abandonBundleImport(input: {
    readonly requestId: ExperienceResearchRequestId;
    readonly claimToken: string;
    readonly stagingFileId: string;
  }): void {
    this.#client
      .transaction(() => {
        this.#client
          .prepare(
            `UPDATE experience_research_requests
           SET bundle_import_token = NULL, bundle_import_claimed_at = NULL,
               bundle_import_file_id = NULL
           WHERE id = ? AND bundle_import_token = ? AND bundle_import_file_id = ?`,
          )
          .run(input.requestId, input.claimToken, input.stagingFileId);
        this.#deleteUnreferencedStagingFile(input.stagingFileId);
      })
      .immediate();
  }

  /** 执行数据库组件对外暴露的操作。 */
  public reviewCandidate(input: {
    readonly requestId: ExperienceResearchRequestId;
    readonly experienceId: InterviewExperienceId;
    readonly expectedRevision: number;
    readonly decision: 'accept' | 'reject';
    readonly now: UtcInstant;
  }): ExperienceResearchDetail | null {
    return this.#client.transaction(() => {
      const request = this.#client
        .prepare(
          `SELECT revision, bundle_import_token
           FROM experience_research_requests WHERE id = ?`,
        )
        .get(input.requestId) as
        { readonly revision: number; readonly bundle_import_token: string | null } | undefined;
      if (request?.revision !== input.expectedRevision || request.bundle_import_token !== null) {
        return null;
      }
      const changed = this.#client
        .prepare(
          `UPDATE interview_experiences SET review_status = ?
           WHERE id = ? AND research_request_id = ? AND source_type = 'community'
             AND review_status = 'needs_review'`,
        )
        .run(
          input.decision === 'accept' ? 'accepted' : 'rejected',
          input.experienceId,
          input.requestId,
        ).changes;
      if (changed !== 1) return null;
      const pending = Number(
        this.#client
          .prepare(
            `SELECT count(*) FROM interview_experiences
             WHERE research_request_id = ? AND review_status = 'needs_review'`,
          )
          .pluck()
          .get(input.requestId),
      );
      this.#client
        .prepare(
          `UPDATE experience_research_requests SET state = ?, revision = revision + 1,
             updated_at = ? WHERE id = ? AND revision = ? AND bundle_import_token IS NULL`,
        )
        .run(
          pending === 0 ? 'completed' : 'needs_review',
          input.now,
          input.requestId,
          request.revision,
        );
      return this.getRequest(input.requestId);
    })();
  }

  /** 执行数据库组件对外暴露的操作。 */
  public listAccepted(
    filter: CommunityExperienceFilter = {},
  ): readonly CommunityExperienceSummary[] {
    const conditions = ["source_type = 'community'", "review_status = 'accepted'"];
    const parameters: string[] = [];
    for (const [column, value] of [
      ['company', filter.company],
      ['role', filter.role],
      ['stage', filter.stage],
    ] as const) {
      if (value === undefined) continue;
      conditions.push(`${column} = ? COLLATE NOCASE`);
      parameters.push(value);
    }
    const experiences = (
      this.#client
        .prepare(
          `SELECT ${experienceColumns} FROM interview_experiences
           WHERE ${conditions.join(' AND ')}
           ORDER BY occurred_on DESC, id`,
        )
        .all(...parameters) as CommunityExperienceRow[]
    ).map(experienceRecord);
    const counts = this.#occurrenceCounts(
      "e.source_type = 'community' AND e.review_status = 'accepted'",
      [],
    );
    const query = this.#client.prepare(
      `SELECT ${questionColumns} FROM interview_question_entries
       WHERE experience_id = ? ORDER BY sequence_no`,
    );
    return experiences.map((experience) => ({
      experience,
      questions: (query.all(experience.id) as CommunityQuestionRow[]).map(questionRecord),
      occurrenceCounts: counts,
    }));
  }

  /** 处理数据库类内部的辅助逻辑。 */
  #deleteUnreferencedStagingFile(fileId: string): void {
    const entityIds = this.#client
      .prepare('SELECT entity_id FROM file_entity_mappings WHERE file_id = ?')
      .pluck()
      .all(fileId) as string[];
    const deleted = this.#client
      .prepare(
        `DELETE FROM files
         WHERE id = ? AND kind = 'interview_research'
           AND NOT EXISTS (
             SELECT 1 FROM experience_research_requests request
             WHERE request.bundle_file_id = files.id
                OR request.bundle_import_file_id = files.id
           )
           AND NOT EXISTS (
             SELECT 1 FROM interview_experiences experience
             WHERE experience.file_id = files.id
           )`,
      )
      .run(fileId).changes;
    if (deleted !== 1) return;
    const removeOrphanEntity = this.#client.prepare(
      `DELETE FROM entities
       WHERE id = ?
         AND NOT EXISTS (
           SELECT 1 FROM file_entity_mappings mapping WHERE mapping.entity_id = entities.id
         )`,
    );
    for (const entityId of entityIds) removeOrphanEntity.run(entityId);
  }

  /** 处理数据库类内部的辅助逻辑。 */
  #taskMayPublish(taskId: TaskId, currentTaskId: string | null): boolean {
    if (currentTaskId !== taskId) return false;
    return (
      this.#client
        .prepare(
          `SELECT 1 FROM tasks
           WHERE id = ? AND status = 'running' AND cancel_requested_at IS NULL`,
        )
        .pluck()
        .get(taskId) === 1
    );
  }

  /** 处理数据库类内部的辅助逻辑。 */
  #deleteUncommittedFileVersions(fileId: string, committedVersion: number): void {
    const entityIds = this.#client
      .prepare(
        `SELECT entity_id FROM file_entity_mappings
         WHERE file_id = ? AND version_no > ?`,
      )
      .pluck()
      .all(fileId, committedVersion) as string[];
    this.#client
      .prepare(
        `DELETE FROM file_entity_mappings
         WHERE file_id = ? AND version_no > ?`,
      )
      .run(fileId, committedVersion);
    const removeOrphanEntity = this.#client.prepare(
      `DELETE FROM entities
       WHERE id = ?
         AND NOT EXISTS (
           SELECT 1 FROM file_entity_mappings mapping WHERE mapping.entity_id = entities.id
         )`,
    );
    for (const entityId of entityIds) removeOrphanEntity.run(entityId);
  }

  /** 处理数据库类内部的辅助逻辑。 */
  #occurrenceCounts(
    where: string,
    parameters: readonly unknown[],
  ): Readonly<Record<string, number>> {
    const rows = this.#client
      .prepare(
        `SELECT q.question_fingerprint AS fingerprint, count(DISTINCT e.source_url) AS occurrences
         FROM interview_question_entries q
         JOIN interview_experiences e ON e.id = q.experience_id
         WHERE ${where} AND e.review_status <> 'rejected' AND q.question_fingerprint IS NOT NULL
         GROUP BY q.question_fingerprint`,
      )
      .all(...parameters) as { readonly fingerprint: string; readonly occurrences: number }[];
    return Object.fromEntries(rows.map((row) => [row.fingerprint, row.occurrences]));
  }
}
