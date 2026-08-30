import type {
  CurrentJobRecord,
  CachedSourceJobDetail,
  FinishSyncRunInput,
  SourceSyncPolicy,
  StartSyncRunInput,
  StartSyncRunResult,
  SyncRepository,
  SyncRunStats,
  SyncSourceRecord,
} from '@jobhunter/application';
import {
  canonicalJson,
  parseContentHash,
  parseId,
  parseNormalizedJob,
  revisionNumber,
  utcInstant,
  type ContentHash,
  type JobSourceId,
  type SyncRunId,
  type UtcInstant,
} from '@jobhunter/domain';
import type Database from 'better-sqlite3';
import { z } from 'zod';

const ORPHANED_RUN_RECOVERY_MS = 15 * 60_000;
const INITIAL_SYNC_RUN_STATS_JSON = canonicalJson({
  discovered: 0,
  created: 0,
  unchanged: 0,
  revised: 0,
  restored: 0,
  staled: 0,
  closed: 0,
  isolated: 0,
  skippedNonDomestic: 0,
  skippedUnknownRegion: 0,
  skippedOutOfScope: 0,
  followupEnqueued: 0,
} satisfies SyncRunStats);

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

function currentJob(row: CurrentJobRow): CurrentJobRecord {
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

export class SqliteSyncRepository implements SyncRepository {
  readonly #client: Database.Database;

  public constructor(client: Database.Database) {
    this.#client = client;
  }

  public getSource(sourceId: JobSourceId): SyncSourceRecord | null {
    const row = this.#client
      .prepare(
        `SELECT s.id, s.company_id, s.adapter_key, s.config_json, s.sync_policy_version,
                s.sync_policy_json,
                CASE WHEN s.enabled = 1 AND company.enabled = 1 AND channel.enabled = 1
                     THEN 1 ELSE 0 END AS enabled,
                s.consecutive_failures,
                (SELECT r.cursor_out_json FROM sync_runs r
                 WHERE r.source_id = s.id AND r.status = 'succeeded'
                   AND r.cursor_out_json IS NOT NULL
                 ORDER BY r.finished_at DESC LIMIT 1) AS cursor_out_json
         FROM job_sources s
         JOIN companies company ON company.id = s.company_id
         JOIN source_channels channel ON channel.id = s.channel_id
         WHERE s.id = ?`,
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
    this.#client
      .prepare(
        `UPDATE sync_runs
         SET status = 'cancelled', coverage = CASE WHEN coverage = 'complete' THEN 'partial' ELSE coverage END,
             error_category = 'orphaned_run',
             error_summary = 'The worker stopped before this synchronization could finish.',
             finished_at = ?
         WHERE source_id = ? AND status = 'running' AND started_at <= ?`,
      )
      .run(input.startedAt, input.sourceId, input.startedAt - ORPHANED_RUN_RECOVERY_MS);
    try {
      this.#client
        .prepare(
          `INSERT INTO sync_runs
           (id, source_id, trigger, status, coverage, adapter_version, normalizer_version,
            sync_policy_version, source_config_hash, cursor_in_json, cursor_out_json, stats_json,
            error_category, error_summary, started_at, finished_at)
           VALUES (?, ?, ?, 'running', ?, ?, ?, ?, ?, ?, NULL, ?, NULL, NULL, ?, NULL)`,
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
          INITIAL_SYNC_RUN_STATS_JSON,
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

  public getCachedJobDetail(
    sourceId: JobSourceId,
    externalJobId: string,
    listContentHash: ContentHash,
    adapterVersion: string,
  ): CachedSourceJobDetail | null {
    const row = this.#client
      .prepare(
        `SELECT detail_json, list_content_hash, adapter_version
         FROM source_job_details
         WHERE source_id = ? AND external_job_id = ? AND status = 'succeeded'
           AND adapter_version = ?`,
      )
      .get(sourceId, externalJobId, adapterVersion) as
      | {
          readonly detail_json: string;
          readonly list_content_hash: string;
          readonly adapter_version: string;
        }
      | undefined;
    void listContentHash;
    if (!row) return null;
    return {
      detail: JSON.parse(row.detail_json) as unknown,
      listContentHash: parseContentHash(row.list_content_hash),
      adapterVersion: row.adapter_version,
    };
  }

  public recordJobDetailSuccess(input: {
    readonly sourceId: JobSourceId;
    readonly externalJobId: string;
    readonly listContentHash: ContentHash;
    readonly adapterVersion: string;
    readonly detail: unknown;
    readonly fetchedAt: UtcInstant;
  }): void {
    this.#client
      .prepare(
        `INSERT INTO source_job_details
         (source_id, external_job_id, list_content_hash, adapter_version, status, detail_json,
          error_category, error_summary, fetched_at, updated_at)
         VALUES (?, ?, ?, ?, 'succeeded', ?, NULL, NULL, ?, ?)
         ON CONFLICT(source_id, external_job_id) DO UPDATE SET
           list_content_hash = excluded.list_content_hash,
           adapter_version = excluded.adapter_version,
           status = 'succeeded', detail_json = excluded.detail_json,
           error_category = NULL, error_summary = NULL,
           fetched_at = excluded.fetched_at, updated_at = excluded.updated_at`,
      )
      .run(
        input.sourceId,
        input.externalJobId,
        input.listContentHash,
        input.adapterVersion,
        canonicalJson(input.detail),
        input.fetchedAt,
        input.fetchedAt,
      );
  }

  public recordJobDetailFailure(input: {
    readonly sourceId: JobSourceId;
    readonly externalJobId: string;
    readonly listContentHash: ContentHash;
    readonly adapterVersion: string;
    readonly errorCategory: string;
    readonly errorSummary: string;
    readonly occurredAt: UtcInstant;
  }): void {
    this.#client
      .prepare(
        `INSERT INTO source_job_details
         (source_id, external_job_id, list_content_hash, adapter_version, status, detail_json,
          error_category, error_summary, fetched_at, updated_at)
         VALUES (?, ?, ?, ?, 'failed', NULL, ?, ?, NULL, ?)
         ON CONFLICT(source_id, external_job_id) DO UPDATE SET
           list_content_hash = excluded.list_content_hash,
           adapter_version = excluded.adapter_version,
           status = 'failed', detail_json = NULL,
           error_category = excluded.error_category, error_summary = excluded.error_summary,
           fetched_at = NULL, updated_at = excluded.updated_at`,
      )
      .run(
        input.sourceId,
        input.externalJobId,
        input.listContentHash,
        input.adapterVersion,
        input.errorCategory,
        input.errorSummary,
        input.occurredAt,
      );
  }

  public recordItemFailure(input: {
    readonly id: string;
    readonly runId: SyncRunId;
    readonly sourceId: JobSourceId;
    readonly externalJobId: string;
    readonly stage: 'normalize' | 'identity';
    readonly errorCategory: string;
    readonly errorSummary: string;
    readonly sourceUrl: string;
    readonly occurredAt: UtcInstant;
  }): void {
    this.#client
      .prepare(
        `INSERT INTO events
         (id, stream_type, stream_id, sequence_no, event_type, payload_json, occurred_at)
         SELECT ?, 'sync_run', ?, COALESCE(MAX(sequence_no), 0) + 1,
                'sync.item.failed', ?, ?
         FROM events WHERE stream_type = 'sync_run' AND stream_id = ?`,
      )
      .run(
        input.id,
        input.runId,
        JSON.stringify({
          sourceId: input.sourceId,
          externalJobId: input.externalJobId,
          stage: input.stage,
          errorCategory: input.errorCategory,
          errorSummary: input.errorSummary,
          sourceUrl: input.sourceUrl,
        }),
        input.occurredAt,
        input.runId,
      );
  }

  public findUnseenJobs(
    sourceId: JobSourceId,
    runId: SyncRunId,
    limit: number,
  ): readonly CurrentJobRecord[] {
    const rows = this.#client
      .prepare(
        `SELECT j.id, r.id AS revision_id, j.source_id, j.external_job_id, j.status, j.missing_count,
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
           coverage_evidence_json = ?, error_category = ?, error_summary = ?, finished_at = ?
         WHERE id = ? AND source_id = ? AND status = 'running'`,
      )
      .run(
        input.status,
        input.coverage,
        input.status === 'succeeded' && input.cursorOut !== null
          ? canonicalJson(input.cursorOut)
          : null,
        canonicalJson(input.stats),
        canonicalJson(input.coverageEvidence),
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
