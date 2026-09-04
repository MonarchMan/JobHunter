import type {
  CurrentJobRecord,
  JobRepository,
  PersistJobMutation,
  PersistJobStatus,
} from '@jobhunter/application';
import {
  canonicalJson,
  parseContentHash,
  parseId,
  parseNormalizedJob,
  revisionNumber,
  utcInstant,
  type JobId,
  type SyncRunId,
  type UtcInstant,
} from '@jobhunter/domain';
import type Database from 'better-sqlite3';

/** 数据库查询结果对应的行结构。 */
interface CurrentJobRow {
  readonly id: string;
  readonly revision_id: string;
  readonly source_id: string;
  readonly external_job_id: string;
  readonly revision_no: number;
  readonly content_hash: string;
  readonly snapshot_json: string;
  readonly status: 'active' | 'stale' | 'closed';
  readonly missing_count: number;
  readonly last_seen_at: number;
  readonly closed_at: number | null;
}

/** 持久化职位规范化结果、修订快照和来源观测。 */
export class SqliteJobRepository implements JobRepository {
  readonly #client: Database.Database;

  public constructor(client: Database.Database) {
    this.#client = client;
  }

  /** 执行数据库组件对外暴露的操作。 */
  public findCurrent(identity: {
    readonly sourceId: CurrentJobRecord['identity']['sourceId'];
    readonly externalJobId: string;
  }): CurrentJobRecord | null {
    const row = this.#client
      .prepare(
        `SELECT j.id, r.id AS revision_id, j.source_id, j.external_job_id, j.status, j.missing_count,
                j.last_seen_at, j.closed_at, r.revision_no, r.content_hash, r.snapshot_json
         FROM jobs j
         JOIN job_revisions r ON r.job_id = j.id
         WHERE j.source_id = ? AND j.external_job_id = ?
         ORDER BY r.revision_no DESC
         LIMIT 1`,
      )
      .get(identity.sourceId, identity.externalJobId) as CurrentJobRow | undefined;
    if (!row) return null;

    return {
      jobId: parseId(row.id, 'Job'),
      revisionId: parseId(row.revision_id, 'JobRevision'),
      identity: {
        sourceId: parseId(row.source_id, 'JobSource'),
        externalJobId: row.external_job_id,
      },
      revisionNumber: revisionNumber(row.revision_no),
      contentHash: parseContentHash(row.content_hash),
      normalized: parseNormalizedJob(JSON.parse(row.snapshot_json) as unknown),
      lifecycle: {
        status: row.status,
        missingCount: row.missing_count,
        lastSeenAt: utcInstant(row.last_seen_at),
        closedAt: row.closed_at === null ? null : utcInstant(row.closed_at),
      },
    };
  }

  /** 执行数据库组件对外暴露的操作。 */
  public persistMutation(input: PersistJobMutation): void {
    const normalized = input.decision.normalized;
    if (input.decision.type === 'create') {
      this.#client
        .prepare(
          `INSERT INTO jobs
           (id, company_id, source_id, external_job_id, title, department, job_family, job_subfamily,
            locations_json, employment_type, recruitment_category, experience_text, education_text, description,
            detail_url, apply_url, published_at, status, missing_count, content_hash,
            first_seen_at, last_seen_at, closed_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 0, ?, ?, ?, NULL, ?, ?)`,
        )
        .run(
          input.jobId,
          normalized.companyId,
          normalized.sourceId,
          normalized.externalJobId,
          normalized.title,
          normalized.department,
          normalized.jobFamily,
          normalized.jobSubfamily,
          canonicalJson(normalized.locations),
          normalized.employmentType,
          normalized.recruitmentCategory,
          normalized.experienceText,
          normalized.educationText,
          normalized.description,
          normalized.detailUrl,
          normalized.applyUrl,
          normalized.publishedAt,
          input.decision.contentHash,
          input.observedAt,
          input.observedAt,
          input.observedAt,
          input.observedAt,
        );
      this.#client
        .prepare(
          `INSERT INTO events
           (id, stream_type, stream_id, sequence_no, event_type, payload_json, occurred_at)
           VALUES (?, 'job', ?, 1, 'job.status.changed', ?, ?)`,
        )
        .run(
          input.statusEventId,
          input.jobId,
          canonicalJson({
            syncRunId: input.syncRunId,
            fromStatus: null,
            toStatus: 'active',
            reasonCode: 'first_observed',
            evidence: {
              sourcePayloadHash: input.sourcePayloadHash,
              sourceUrl: input.sourceUrl,
            },
          }),
          input.observedAt,
        );
    } else {
      this.#client
        .prepare(
          `UPDATE jobs SET
             company_id = ?, title = ?, department = ?, job_family = ?, job_subfamily = ?, locations_json = ?,
             employment_type = ?, recruitment_category = ?, experience_text = ?, education_text = ?, description = ?,
             detail_url = ?, apply_url = ?, published_at = ?, content_hash = ?,
             last_seen_at = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          normalized.companyId,
          normalized.title,
          normalized.department,
          normalized.jobFamily,
          normalized.jobSubfamily,
          canonicalJson(normalized.locations),
          normalized.employmentType,
          normalized.recruitmentCategory,
          normalized.experienceText,
          normalized.educationText,
          normalized.description,
          normalized.detailUrl,
          normalized.applyUrl,
          normalized.publishedAt,
          input.decision.contentHash,
          input.observedAt,
          input.observedAt,
          input.jobId,
        );
    }

    this.#client
      .prepare(
        `INSERT INTO job_revisions
         (id, job_id, revision_no, content_hash, normalizer_version, source_payload_hash,
          source_url, snapshot_json, change_set_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.revisionId,
        input.jobId,
        input.decision.revisionNumber,
        input.decision.contentHash,
        input.normalizerVersion,
        input.sourcePayloadHash,
        input.sourceUrl,
        canonicalJson(normalized),
        canonicalJson(input.decision.type === 'create' ? [] : input.decision.changes),
        input.observedAt,
      );
    this.recordObservation({
      jobId: input.jobId,
      syncRunId: input.syncRunId,
      jobRevisionId: parseId(input.revisionId, 'JobRevision'),
      observedAt: input.observedAt,
    });
  }

  /** 执行数据库组件对外暴露的操作。 */
  public persistDetailRevision(input: Parameters<JobRepository['persistDetailRevision']>[0]): void {
    const normalized = input.decision.normalized;
    this.#client
      .prepare(
        `UPDATE jobs SET
           company_id = ?, title = ?, department = ?, job_family = ?, job_subfamily = ?, locations_json = ?,
           employment_type = ?, recruitment_category = ?, experience_text = ?, education_text = ?, description = ?,
           detail_url = ?, apply_url = ?, published_at = ?, content_hash = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        normalized.companyId,
        normalized.title,
        normalized.department,
        normalized.jobFamily,
        normalized.jobSubfamily,
        canonicalJson(normalized.locations),
        normalized.employmentType,
        normalized.recruitmentCategory,
        normalized.experienceText,
        normalized.educationText,
        normalized.description,
        normalized.detailUrl,
        normalized.applyUrl,
        normalized.publishedAt,
        input.decision.contentHash,
        input.occurredAt,
        input.decision.jobId,
      );
    this.#client
      .prepare(
        `INSERT INTO job_revisions
         (id, job_id, revision_no, content_hash, normalizer_version, source_payload_hash,
          source_url, snapshot_json, change_set_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.revisionId,
        input.decision.jobId,
        input.decision.revisionNumber,
        input.decision.contentHash,
        input.normalizerVersion,
        input.sourcePayloadHash,
        input.sourceUrl,
        canonicalJson(normalized),
        canonicalJson(input.decision.changes),
        input.occurredAt,
      );
  }

  /** 执行数据库组件对外暴露的操作。 */
  public recordObservation(input: {
    readonly jobId: JobId;
    readonly syncRunId: SyncRunId;
    readonly jobRevisionId: Parameters<JobRepository['recordObservation']>[0]['jobRevisionId'];
    readonly observedAt: UtcInstant;
  }): void {
    this.#client
      .prepare(
        `INSERT INTO job_observations (job_id, sync_run_id, job_revision_id, observed_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(job_id, sync_run_id) DO NOTHING`,
      )
      .run(input.jobId, input.syncRunId, input.jobRevisionId, input.observedAt);
    this.#client
      .prepare(
        'INSERT INTO sync_seen_jobs (sync_run_id, job_id) VALUES (?, ?) ON CONFLICT DO NOTHING',
      )
      .run(input.syncRunId, input.jobId);
  }

  /** 执行数据库组件对外暴露的操作。 */
  public persistStatus(input: PersistJobStatus): void {
    if (input.fromStatus !== input.lifecycle.status && (!input.eventId || !input.reason)) {
      throw new Error('A status change requires an event ID and reason.');
    }
    this.#client
      .prepare(
        `UPDATE jobs SET status = ?, missing_count = ?, last_seen_at = ?, closed_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        input.lifecycle.status,
        input.lifecycle.missingCount,
        input.lifecycle.lastSeenAt,
        input.lifecycle.closedAt,
        input.occurredAt,
        input.jobId,
      );
    if (input.eventId && input.reason) {
      this.#client
        .prepare(
          `INSERT INTO events
           (id, stream_type, stream_id, sequence_no, event_type, payload_json, occurred_at)
           SELECT ?, 'job', ?, COALESCE(MAX(sequence_no), 0) + 1,
                  'job.status.changed', ?, ?
           FROM events WHERE stream_type = 'job' AND stream_id = ?`,
        )
        .run(
          input.eventId,
          input.jobId,
          canonicalJson({
            syncRunId: input.syncRunId,
            fromStatus: input.fromStatus,
            toStatus: input.lifecycle.status,
            reasonCode: input.reason,
            evidence: input.evidence ?? {},
          }),
          input.occurredAt,
          input.jobId,
        );
    }
  }
}
