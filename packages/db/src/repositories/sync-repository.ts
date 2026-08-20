import type {
  CurrentJobRecord,
  FinishSyncRunInput,
  PersistedRawJob,
  PersistRawJobInput,
  SourceSyncPolicy,
  StartSyncRunInput,
  StartSyncRunResult,
  SyncRepository,
  SyncSourceRecord,
} from '@jobhunter/application';
import {
  canonicalJson,
  parseContentHash,
  parseId,
  parseNormalizedJob,
  revisionNumber,
  utcInstant,
  type JobSourceId,
  type SyncRunId,
} from '@jobhunter/domain';
import type Database from 'better-sqlite3';
import { z } from 'zod';

const syncPolicySchema: z.ZodType<SourceSyncPolicy> = z
  .object({
    staleAfterMisses: z.number().int().min(1),
    closeAfterMisses: z.number().int().min(1),
    degradedAfterFailures: z.number().int().min(1),
    unhealthyAfterFailures: z.number().int().min(1),
    enrichNewRevisions: z.boolean(),
    requestTimeoutMs: z.number().int().min(100).max(120_000),
  })
  .refine((policy) => policy.closeAfterMisses >= policy.staleAfterMisses)
  .refine((policy) => policy.unhealthyAfterFailures >= policy.degradedAfterFailures);

interface SourceRow {
  readonly id: string;
  readonly company_id: string;
  readonly adapter_key: string;
  readonly config_json: string;
  readonly sync_policy_version: string;
  readonly sync_policy_json: string;
  readonly enabled: number;
  readonly consecutive_failures: number;
  readonly cursor_out_json: string | null;
}

interface CurrentJobRow {
  readonly id: string;
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

function currentJob(row: CurrentJobRow): CurrentJobRecord {
  return {
    jobId: parseId(row.id, 'Job'),
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

export class SqliteSyncRepository implements SyncRepository {
  readonly #client: Database.Database;

  public constructor(client: Database.Database) {
    this.#client = client;
  }

  public getSource(sourceId: JobSourceId): SyncSourceRecord | null {
    const row = this.#client
      .prepare(
        `SELECT s.id, s.company_id, s.adapter_key, s.config_json, s.sync_policy_version,
                s.sync_policy_json, s.enabled, s.consecutive_failures,
                (SELECT r.cursor_out_json FROM sync_runs r
                 WHERE r.source_id = s.id AND r.status = 'succeeded'
                   AND r.cursor_out_json IS NOT NULL
                 ORDER BY r.finished_at DESC LIMIT 1) AS cursor_out_json
         FROM job_sources s WHERE s.id = ?`,
      )
      .get(sourceId) as SourceRow | undefined;
    if (!row) return null;
    return {
      id: parseId(row.id, 'JobSource'),
      companyId: parseId(row.company_id, 'Company'),
      adapterKey: row.adapter_key,
      config: JSON.parse(row.config_json) as unknown,
      syncPolicyVersion: row.sync_policy_version,
      syncPolicy: syncPolicySchema.parse(JSON.parse(row.sync_policy_json) as unknown),
      enabled: row.enabled === 1,
      cursor: row.cursor_out_json === null ? null : (JSON.parse(row.cursor_out_json) as unknown),
      consecutiveFailures: row.consecutive_failures,
    };
  }

  public startRun(input: StartSyncRunInput): StartSyncRunResult {
    try {
      this.#client
        .prepare(
          `INSERT INTO sync_runs
           (id, source_id, trigger, status, coverage, adapter_version, normalizer_version,
            sync_policy_version, source_config_hash, cursor_in_json, cursor_out_json, stats_json,
            error_category, error_summary, started_at, finished_at)
           VALUES (?, ?, ?, 'running', ?, ?, ?, ?, ?, ?, NULL, '{}', NULL, NULL, ?, NULL)`,
        )
        .run(
          input.id,
          input.sourceId,
          input.trigger,
          input.coverage,
          input.adapterVersion,
          input.normalizerVersion,
          input.syncPolicyVersion,
          input.sourceConfigHash,
          input.cursorIn === null ? null : canonicalJson(input.cursorIn),
          input.startedAt,
        );
      return { kind: 'started', runId: input.id };
    } catch (error) {
      const running = this.#client
        .prepare("SELECT id FROM sync_runs WHERE source_id = ? AND status = 'running'")
        .get(input.sourceId) as { readonly id: string } | undefined;
      if (running) return { kind: 'conflict', runId: parseId(running.id, 'SyncRun') };
      throw error;
    }
  }

  public persistRawJob(input: PersistRawJobInput): PersistedRawJob {
    const result = this.#client
      .prepare(
        `INSERT INTO raw_job_records
         (id, source_id, first_sync_run_id, external_job_id, identity_key, source_url,
          content_hash, payload_json, artifact_id, captured_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(source_id, identity_key, content_hash) DO NOTHING`,
      )
      .run(
        input.id,
        input.sourceId,
        input.syncRunId,
        input.externalJobId,
        input.identityKey,
        input.sourceUrl,
        input.contentHash,
        input.payload === null ? null : canonicalJson(input.payload),
        input.artifactId,
        input.capturedAt,
      );
    if (result.changes === 1) return { id: input.id, deduplicated: false };
    const existing = this.#client
      .prepare(
        `SELECT id FROM raw_job_records
         WHERE source_id = ? AND identity_key = ? AND content_hash = ?`,
      )
      .get(input.sourceId, input.identityKey, input.contentHash) as
      { readonly id: string } | undefined;
    if (!existing) throw new Error('Raw job deduplication conflict could not be resolved.');
    return { id: existing.id, deduplicated: true };
  }

  public findUnseenJobs(
    sourceId: JobSourceId,
    runId: SyncRunId,
    limit: number,
  ): readonly CurrentJobRecord[] {
    const rows = this.#client
      .prepare(
        `SELECT j.id, j.source_id, j.external_job_id, j.status, j.missing_count,
                j.last_seen_at, j.closed_at, r.revision_no, r.content_hash, r.snapshot_json
         FROM jobs j
         JOIN job_revisions r ON r.job_id = j.id
          AND r.revision_no = (SELECT MAX(r2.revision_no) FROM job_revisions r2 WHERE r2.job_id = j.id)
         WHERE j.source_id = ?
           AND NOT EXISTS (SELECT 1 FROM sync_seen_jobs seen
                           WHERE seen.sync_run_id = ? AND seen.job_id = j.id)
         ORDER BY j.id LIMIT ?`,
      )
      .all(sourceId, runId, limit) as CurrentJobRow[];
    return rows.map(currentJob);
  }

  public markMissingProcessed(runId: SyncRunId, jobId: CurrentJobRecord['jobId']): void {
    this.#client
      .prepare(
        'INSERT INTO sync_seen_jobs (sync_run_id, job_id) VALUES (?, ?) ON CONFLICT DO NOTHING',
      )
      .run(runId, jobId);
  }

  public finishRun(input: FinishSyncRunInput): boolean {
    const updated = this.#client
      .prepare(
        `UPDATE sync_runs SET status = ?, coverage = ?, cursor_out_json = ?, stats_json = ?,
           error_category = ?, error_summary = ?, finished_at = ?
         WHERE id = ? AND source_id = ? AND status = 'running'`,
      )
      .run(
        input.status,
        input.coverage,
        input.status === 'succeeded' && input.cursorOut !== null
          ? canonicalJson(input.cursorOut)
          : null,
        canonicalJson(input.stats),
        input.errorCategory,
        input.errorSummary,
        input.finishedAt,
        input.runId,
        input.sourceId,
      ).changes;
    if (updated !== 1) return false;
    this.#client
      .prepare(
        `UPDATE job_sources SET health_status = ?, consecutive_failures = ?,
           last_success_at = CASE WHEN ? = 'succeeded' THEN ? ELSE last_success_at END,
           last_failure_at = CASE WHEN ? != 'succeeded' THEN ? ELSE last_failure_at END,
           updated_at = ? WHERE id = ?`,
      )
      .run(
        input.sourceHealth,
        input.consecutiveFailures,
        input.status,
        input.finishedAt,
        input.status,
        input.finishedAt,
        input.finishedAt,
        input.sourceId,
      );
    return true;
  }

  public cleanupSeen(runId: SyncRunId): void {
    this.#client.prepare('DELETE FROM sync_seen_jobs WHERE sync_run_id = ?').run(runId);
  }
}
