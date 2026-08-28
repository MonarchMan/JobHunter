import type {
  SourceChannelOverview,
  SourceManagementRepository,
  SourceOverview,
} from '@jobhunter/application';
import { parseId, utcInstant } from '@jobhunter/domain';
import type Database from 'better-sqlite3';

interface SourceOverviewRow {
  readonly id: string;
  readonly company_id: string;
  readonly channel_id: string;
  readonly channel: SourceOverview['channel'];
  readonly company_name: string;
  readonly slug: string;
  readonly adapter_key: string;
  readonly coverage_role: SourceOverview['coverageRole'];
  readonly enabled: number;
  readonly company_enabled: number;
  readonly channel_enabled: number;
  readonly support_status: SourceOverview['supportStatus'];
  readonly health_status: SourceOverview['healthStatus'];
  readonly run_id: string | null;
  readonly run_status: NonNullable<SourceOverview['lastRun']>['status'] | null;
  readonly coverage: NonNullable<SourceOverview['lastRun']>['coverage'] | null;
  readonly started_at: number | null;
  readonly finished_at: number | null;
}

const query = `
  SELECT source.id, source.company_id, source.channel_id, company.name AS company_name,
         source.slug, source.adapter_key, source.coverage_role, channel.channel,
         source.enabled, company.enabled AS company_enabled, channel.enabled AS channel_enabled,
         source.support_status, source.health_status,
         run.id AS run_id, run.status AS run_status, run.coverage,
         run.started_at, run.finished_at
  FROM job_sources source
  JOIN companies company ON company.id = source.company_id
  JOIN source_channels channel ON channel.id = source.channel_id
  LEFT JOIN sync_runs run ON run.id = (
    SELECT latest.id FROM sync_runs latest
    WHERE latest.source_id = source.id
    ORDER BY latest.started_at DESC, latest.id DESC LIMIT 1
  )`;

function overview(row: SourceOverviewRow): SourceOverview {
  return {
    id: parseId(row.id, 'JobSource'),
    companyId: parseId(row.company_id, 'Company'),
    channelId: parseId(row.channel_id, 'SourceChannel'),
    channel: row.channel,
    companyName: row.company_name,
    slug: row.slug,
    adapterKey: row.adapter_key,
    coverageRole: row.coverage_role,
    enabled: row.enabled === 1,
    effectiveEnabled: row.enabled === 1 && row.company_enabled === 1 && row.channel_enabled === 1,
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

interface ChannelRow {
  readonly id: string;
  readonly company_id: string;
  readonly company_name: string;
  readonly slug: string;
  readonly channel: SourceChannelOverview['channel'];
  readonly enabled: number;
  readonly company_enabled: number;
  readonly support_note: string | null;
}

function aggregateSupport(
  sources: readonly SourceOverview[],
): SourceChannelOverview['supportStatus'] {
  const required = sources.filter((source) => source.coverageRole === 'required');
  if (required.length === 0 || required.every((source) => source.supportStatus === 'blocked')) {
    return 'blocked';
  }
  return required.every((source) => source.supportStatus === 'supported')
    ? 'supported'
    : 'experimental';
}

function aggregateHealth(
  sources: readonly SourceOverview[],
): SourceChannelOverview['healthStatus'] {
  const required = sources.filter(
    (source) => source.coverageRole === 'required' && source.effectiveEnabled,
  );
  if (required.length === 0) return 'unknown';
  if (required.every((source) => source.healthStatus === 'healthy')) return 'healthy';
  if (required.every((source) => source.healthStatus === 'unhealthy')) return 'unhealthy';
  if (required.every((source) => source.healthStatus === 'unknown')) return 'unknown';
  return 'degraded';
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

  public listChannels(): readonly SourceChannelOverview[] {
    const sources = this.list();
    const sourcesByChannel = new Map<string, SourceOverview[]>();
    for (const source of sources) {
      const members = sourcesByChannel.get(source.channelId) ?? [];
      members.push(source);
      sourcesByChannel.set(source.channelId, members);
    }
    const rows = this.#client
      .prepare(
        `SELECT channel.id, channel.company_id, company.name AS company_name,
                channel.slug, channel.channel, channel.enabled,
                company.enabled AS company_enabled, channel.support_note
         FROM source_channels channel
         JOIN companies company ON company.id = channel.company_id
         ORDER BY company.name, channel.channel`,
      )
      .all() as ChannelRow[];
    return rows.map((row) => {
      const members = sourcesByChannel.get(row.id) ?? [];
      return {
        id: parseId(row.id, 'SourceChannel'),
        companyId: parseId(row.company_id, 'Company'),
        companyName: row.company_name,
        slug: row.slug,
        channel: row.channel,
        enabled: row.enabled === 1,
        effectiveEnabled: row.enabled === 1 && row.company_enabled === 1,
        supportNote: row.support_note,
        supportStatus: aggregateSupport(members),
        healthStatus: aggregateHealth(members),
        sources: members,
      };
    });
  }

  public getChannel(
    id: Parameters<SourceManagementRepository['getChannel']>[0],
  ): SourceChannelOverview | null {
    return this.listChannels().find((channel) => channel.id === id) ?? null;
  }
}
