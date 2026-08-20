import type { SourceManagementRepository, SourceOverview } from '@jobhunter/application';
import { parseId, utcInstant } from '@jobhunter/domain';
import type Database from 'better-sqlite3';

interface SourceOverviewRow {
  readonly id: string;
  readonly company_name: string;
  readonly slug: string;
  readonly adapter_key: string;
  readonly enabled: number;
  readonly support_status: SourceOverview['supportStatus'];
  readonly health_status: SourceOverview['healthStatus'];
  readonly run_id: string | null;
  readonly run_status: NonNullable<SourceOverview['lastRun']>['status'] | null;
  readonly coverage: NonNullable<SourceOverview['lastRun']>['coverage'] | null;
  readonly started_at: number | null;
  readonly finished_at: number | null;
}

const query = `
  SELECT source.id, company.name AS company_name, source.slug, source.adapter_key,
         source.enabled, source.support_status, source.health_status,
         run.id AS run_id, run.status AS run_status, run.coverage,
         run.started_at, run.finished_at
  FROM job_sources source
  JOIN companies company ON company.id = source.company_id
  LEFT JOIN sync_runs run ON run.id = (
    SELECT latest.id FROM sync_runs latest
    WHERE latest.source_id = source.id
    ORDER BY latest.started_at DESC, latest.id DESC LIMIT 1
  )`;

function overview(row: SourceOverviewRow): SourceOverview {
  return {
    id: parseId(row.id, 'JobSource'),
    companyName: row.company_name,
    slug: row.slug,
    adapterKey: row.adapter_key,
    enabled: row.enabled === 1,
    supportStatus: row.support_status,
    healthStatus: row.health_status,
    lastRun:
      row.run_id && row.run_status && row.coverage && row.started_at !== null
        ? {
            id: row.run_id,
            status: row.run_status,
            coverage: row.coverage,
            startedAt: utcInstant(row.started_at),
            finishedAt: row.finished_at === null ? null : utcInstant(row.finished_at),
          }
        : null,
  };
}

export class SqliteSourceManagementRepository implements SourceManagementRepository {
  readonly #client: Database.Database;

  public constructor(client: Database.Database) {
    this.#client = client;
  }

  public list(): readonly SourceOverview[] {
    const rows = this.#client
      .prepare(`${query} ORDER BY company.name, source.id`)
      .all() as SourceOverviewRow[];
    return rows.map(overview);
  }

  public get(id: Parameters<SourceManagementRepository['get']>[0]): SourceOverview | null {
    const row = this.#client.prepare(`${query} WHERE source.id = ?`).get(id) as
      SourceOverviewRow | undefined;
    return row ? overview(row) : null;
  }
}
