import type { DashboardReadModel, WebDashboard } from '@jobhunter/application';
import type Database from 'better-sqlite3';

interface CountRow {
  readonly count: number;
}

interface LatestSyncRow {
  readonly source_name: string;
  readonly status: string;
  readonly finished_at: number;
}

function count(client: Database.Database, sql: string, ...parameters: readonly unknown[]): number {
  return (client.prepare(sql).get(...parameters) as CountRow).count;
}

export class SqliteDashboardReadModel implements DashboardReadModel {
  readonly #client: Database.Database;

  public constructor(client: Database.Database) {
    this.#client = client;
  }

  public snapshot(): WebDashboard {
    const latestSync = this.#client
      .prepare(
        `SELECT c.name AS source_name, sr.status, sr.finished_at
         FROM sync_runs sr
         JOIN job_sources js ON js.id = sr.source_id
         JOIN companies c ON c.id = js.company_id
         WHERE sr.finished_at IS NOT NULL
         ORDER BY sr.finished_at DESC, sr.id DESC
         LIMIT 1`,
      )
      .get() as LatestSyncRow | undefined;
    return {
      activeJobs: count(this.#client, `SELECT count(*) AS count FROM jobs WHERE status = 'active'`),
      currentMatches: count(
        this.#client,
        `WITH latest_revisions AS (
           SELECT id, row_number() OVER (PARTITION BY job_id ORDER BY revision_no DESC) AS position
           FROM job_revisions
         )
         SELECT count(*) AS count
         FROM match_results mr
         JOIN profile_versions pv ON pv.id = mr.profile_version_id AND pv.is_current = 1
         JOIN latest_revisions lr ON lr.id = mr.job_revision_id AND lr.position = 1
         WHERE mr.filter_status <> 'excluded'`,
      ),
      sources: {
        healthy: count(
          this.#client,
          `SELECT count(*) AS count FROM job_sources WHERE enabled = 1 AND health_status = 'healthy'`,
        ),
        total: count(this.#client, `SELECT count(*) AS count FROM job_sources WHERE enabled = 1`),
      },
      tasks: {
        pending: count(
          this.#client,
          `SELECT count(*) AS count FROM tasks WHERE status = 'pending'`,
        ),
        failed: count(this.#client, `SELECT count(*) AS count FROM tasks WHERE status = 'failed'`),
      },
      latestSync: latestSync
        ? {
            sourceName: latestSync.source_name,
            status: latestSync.status,
            finishedAt: new Date(latestSync.finished_at).toISOString(),
          }
        : null,
    };
  }
}
