import {
  webSourceSchema,
  type WebSource,
  type WebSourceChannel,
  type WebSourceRepository,
} from '@jobhunter/application/web';
import type { JobSourceId } from '@jobhunter/domain';
import type Database from 'better-sqlite3';
import { z } from 'zod';

interface SourceRow {
  readonly id: string;
  readonly company_id: string;
  readonly company_name: string;
  readonly channel_id: string;
  readonly base_url: string;
  readonly slug: string;
  readonly adapter_key: string;
  readonly coverage_role: WebSource['coverageRole'];
  readonly recruitment_type: WebSource['recruitmentType'];
  readonly enabled: number;
  readonly company_enabled: number;
  readonly channel_enabled: number;
  readonly support_status: WebSource['supportStatus'];
  readonly health_status: WebSource['healthStatus'];
  readonly consecutive_failures: number;
  readonly last_success_at: number | null;
  readonly last_failure_at: number | null;
  readonly run_id: string | null;
  readonly run_status: NonNullable<WebSource['latestRun']>['status'] | null;
  readonly coverage: NonNullable<WebSource['latestRun']>['coverage'] | null;
  readonly stats_json: string | null;
  readonly error_category: string | null;
  readonly error_summary: string | null;
  readonly started_at: number | null;
  readonly finished_at: number | null;
  readonly cron_expression: string | null;
  readonly timezone: string | null;
  readonly schedule_enabled: number | null;
  readonly next_run_at: number | null;
}

const selection = `
  SELECT source.id, source.company_id, source.channel_id, company.name AS company_name, source.base_url,
         source.slug, source.adapter_key, source.coverage_role,
         source.recruitment_type, source.enabled, company.enabled AS company_enabled,
         channel.enabled AS channel_enabled, source.support_status, source.health_status,
         source.consecutive_failures, source.last_success_at, source.last_failure_at,
         run.id AS run_id, run.status AS run_status, run.coverage, run.stats_json,
         run.error_category, run.error_summary, run.started_at, run.finished_at,
         schedule.cron_expression, schedule.timezone, schedule.enabled AS schedule_enabled,
         schedule.next_run_at
  FROM job_sources source
  JOIN companies company ON company.id = source.company_id
  JOIN source_channels channel ON channel.id = source.channel_id
  LEFT JOIN sync_runs run ON run.id = (
    SELECT latest.id FROM sync_runs latest WHERE latest.source_id = source.id
    ORDER BY latest.started_at DESC, latest.id DESC LIMIT 1
  )
  LEFT JOIN schedules schedule ON schedule.schedule_key = 'source.sync:' || source.id`;

function instant(value: number | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

function recruitmentChannels(
  adapterKey: string,
  recruitmentType: WebSource['recruitmentType'],
): WebSource['recruitmentChannels'] {
  if (adapterKey.endsWith('.social')) return ['social'];
  if (adapterKey.endsWith('.intern')) return ['internship'];
  if (adapterKey.endsWith('.campus')) return ['campus'];
  return recruitmentType === 'social'
    ? ['social']
    : recruitmentType === 'campus'
      ? ['campus']
      : ['campus', 'social'];
}

function source(row: SourceRow): WebSource {
  return webSourceSchema.parse({
    id: row.id,
    companyId: row.company_id,
    channelId: row.channel_id,
    companyName: row.company_name,
    officialUrl: row.base_url,
    slug: row.slug,
    adapterKey: row.adapter_key,
    coverageRole: row.coverage_role,
    recruitmentType: row.recruitment_type,
    recruitmentChannels: recruitmentChannels(row.adapter_key, row.recruitment_type),
    enabled: row.enabled === 1,
    effectiveEnabled: row.enabled === 1 && row.company_enabled === 1 && row.channel_enabled === 1,
    supportStatus: row.support_status,
    healthStatus: row.health_status,
    consecutiveFailures: row.consecutive_failures,
    lastSuccessAt: instant(row.last_success_at),
    lastFailureAt: instant(row.last_failure_at),
    latestRun:
      row.run_id && row.run_status && row.coverage && row.started_at !== null
        ? {
            id: row.run_id,
            status: row.run_status,
            coverage: row.coverage,
            stats: z
              .record(z.string(), z.number())
              .parse(JSON.parse(row.stats_json ?? '{}') as unknown),
            errorCategory: row.error_category,
            errorSummary: row.error_summary,
            startedAt: new Date(row.started_at).toISOString(),
            finishedAt: instant(row.finished_at),
          }
        : null,
    schedule:
      row.cron_expression && row.timezone && row.next_run_at !== null
        ? {
            cronExpression: row.cron_expression,
            timezone: row.timezone,
            enabled: row.schedule_enabled === 1,
            nextRunAt: new Date(row.next_run_at).toISOString(),
          }
        : null,
  });
}

interface ChannelRow {
  readonly id: string;
  readonly company_id: string;
  readonly company_name: string;
  readonly slug: string;
  readonly channel: WebSourceChannel['channel'];
  readonly enabled: number;
  readonly company_enabled: number;
  readonly support_note: string | null;
}

function channelSupport(sources: readonly WebSource[]): WebSourceChannel['supportStatus'] {
  const required = sources.filter((source) => source.coverageRole === 'required');
  if (required.length === 0 || required.every((source) => source.supportStatus === 'blocked')) {
    return 'blocked';
  }
  return required.every((source) => source.supportStatus === 'supported')
    ? 'supported'
    : 'experimental';
}

function channelHealth(sources: readonly WebSource[]): WebSourceChannel['healthStatus'] {
  const required = sources.filter(
    (source) => source.coverageRole === 'required' && source.effectiveEnabled,
  );
  if (required.length === 0 || required.every((source) => source.healthStatus === 'unknown')) {
    return 'unknown';
  }
  if (required.every((source) => source.healthStatus === 'healthy')) return 'healthy';
  if (required.every((source) => source.healthStatus === 'unhealthy')) return 'unhealthy';
  return 'degraded';
}

export class SqliteWebSourceRepository implements WebSourceRepository {
  readonly #client: Database.Database;

  public constructor(client: Database.Database) {
    this.#client = client;
  }

  public list(): readonly WebSource[] {
    return (
      this.#client.prepare(`${selection} ORDER BY company.name, source.id`).all() as SourceRow[]
    ).map(source);
  }

  public get(id: JobSourceId): WebSource | null {
    const row = this.#client.prepare(`${selection} WHERE source.id = ?`).get(id) as
      SourceRow | undefined;
    return row ? source(row) : null;
  }

  public setEnabled(id: JobSourceId, enabled: boolean): WebSource {
    const changed = this.#client
      .prepare('UPDATE job_sources SET enabled = ?, updated_at = ? WHERE id = ?')
      .run(enabled ? 1 : 0, Date.now(), id).changes;
    const updated = this.get(id);
    if (changed !== 1 || !updated) throw new TypeError('Source not found.');
    return updated;
  }

  public listChannels(): readonly WebSourceChannel[] {
    const sourcesByChannel = new Map<string, WebSource[]>();
    for (const member of this.list()) {
      const sources = sourcesByChannel.get(member.channelId) ?? [];
      sources.push(member);
      sourcesByChannel.set(member.channelId, sources);
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
      const sources = sourcesByChannel.get(row.id) ?? [];
      return {
        id: row.id,
        companyId: row.company_id,
        companyName: row.company_name,
        slug: row.slug,
        channel: row.channel,
        enabled: row.enabled === 1,
        effectiveEnabled: row.enabled === 1 && row.company_enabled === 1,
        supportNote: row.support_note,
        supportStatus: channelSupport(sources),
        healthStatus: channelHealth(sources),
        sources,
      };
    });
  }

  public getChannel(id: Parameters<WebSourceRepository['getChannel']>[0]): WebSourceChannel | null {
    return this.listChannels().find((channel) => channel.id === id) ?? null;
  }

  public setChannelEnabled(
    id: Parameters<WebSourceRepository['setChannelEnabled']>[0],
    enabled: boolean,
  ): WebSourceChannel {
    const changed = this.#client
      .prepare('UPDATE source_channels SET enabled = ?, updated_at = ? WHERE id = ?')
      .run(enabled ? 1 : 0, Date.now(), id).changes;
    const updated = this.getChannel(id);
    if (changed !== 1 || !updated) throw new TypeError('Source channel not found.');
    return updated;
  }
}
