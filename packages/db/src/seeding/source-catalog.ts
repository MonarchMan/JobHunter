import type Database from 'better-sqlite3';

export interface SourceCatalogSeedRecord {
  readonly company: {
    readonly id: string;
    readonly slug: string;
    readonly name: string;
    readonly aliases: readonly string[];
    readonly industry: string | null;
    readonly sizeTag: 'large' | 'medium' | 'other';
  };
  readonly channel: {
    readonly id: string;
    readonly slug: string;
    readonly type: 'intern' | 'campus' | 'social';
    readonly enabledByDefault: boolean;
    readonly supportNote: string | null;
  };
  readonly sources: readonly {
    readonly id: string;
    readonly slug: string;
    readonly adapterKey: string;
    readonly recruitmentType: 'social' | 'campus' | 'mixed';
    readonly baseUrl: string;
    readonly config: Readonly<Record<string, unknown>>;
    readonly enabledByDefault: boolean;
    readonly supportStatus: 'experimental' | 'supported' | 'blocked';
    readonly supportNote: string | null;
    readonly coverageRole: 'required' | 'supplemental';
  }[];
}

const defaultSyncPolicy = {
  staleAfterMisses: 1,
  closeAfterMisses: 2,
  degradedAfterFailures: 2,
  unhealthyAfterFailures: 4,
  enrichNewRevisions: false,
  requestTimeoutMs: 15_000,
} as const;

export interface SeedSourceCatalogOptions {
  readonly now?: number;
  readonly syncPolicyVersion?: string;
  readonly syncPolicy?: Readonly<Record<string, unknown>>;
}

export function seedSourceCatalog(
  database: Database.Database,
  records: readonly SourceCatalogSeedRecord[],
  options: SeedSourceCatalogOptions = {},
): void {
  const now = options.now ?? Date.now();
  const syncPolicyVersion = options.syncPolicyVersion ?? 'v2';
  const syncPolicyJson = JSON.stringify(options.syncPolicy ?? defaultSyncPolicy);
  const insertCompany = database.prepare(
    `INSERT INTO companies
       (id, slug, name, aliases_json, industry, size_tag, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
     ON CONFLICT(slug) DO UPDATE SET
       name = excluded.name,
       aliases_json = excluded.aliases_json,
       industry = excluded.industry,
       size_tag = excluded.size_tag,
       updated_at = excluded.updated_at`,
  );
  const companyIdBySlug = database.prepare('SELECT id FROM companies WHERE slug = ?').pluck();
  const insertChannel = database.prepare(
    `INSERT INTO source_channels
       (id, company_id, channel, slug, enabled, support_note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(company_id, channel) DO UPDATE SET
       slug = excluded.slug,
       support_note = excluded.support_note,
       updated_at = excluded.updated_at`,
  );
  const channelIdByCompanyAndType = database
    .prepare('SELECT id FROM source_channels WHERE company_id = ? AND channel = ?')
    .pluck();
  const insertSource = database.prepare(
    `INSERT INTO job_sources
       (id, company_id, channel_id, slug, adapter_key, coverage_role, recruitment_type, base_url, config_json,
        sync_policy_version, sync_policy_json, enabled, support_status, support_note,
        health_status, consecutive_failures, last_success_at, last_failure_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unknown', 0, NULL, NULL, ?, ?)
     ON CONFLICT(slug) DO UPDATE SET
       company_id = excluded.company_id,
       channel_id = excluded.channel_id,
       adapter_key = excluded.adapter_key,
       coverage_role = excluded.coverage_role,
       recruitment_type = excluded.recruitment_type,
       base_url = excluded.base_url,
       support_status = excluded.support_status,
       support_note = excluded.support_note,
       updated_at = excluded.updated_at`,
  );

  database.transaction(() => {
    for (const record of records) {
      insertCompany.run(
        record.company.id,
        record.company.slug,
        record.company.name,
        JSON.stringify(record.company.aliases),
        record.company.industry,
        record.company.sizeTag,
        now,
        now,
      );
      const companyId = companyIdBySlug.get(record.company.slug);
      if (typeof companyId !== 'string') {
        throw new TypeError(`Unable to resolve seeded company: ${record.company.slug}`);
      }
      insertChannel.run(
        record.channel.id,
        companyId,
        record.channel.type,
        record.channel.slug,
        record.channel.enabledByDefault ? 1 : 0,
        record.channel.supportNote,
        now,
        now,
      );
      const channelId = channelIdByCompanyAndType.get(companyId, record.channel.type);
      if (typeof channelId !== 'string') {
        throw new TypeError(`Unable to resolve seeded channel: ${record.channel.slug}`);
      }
      for (const source of record.sources) {
        insertSource.run(
          source.id,
          companyId,
          channelId,
          source.slug,
          source.adapterKey,
          source.coverageRole,
          source.recruitmentType,
          source.baseUrl,
          JSON.stringify(source.config),
          syncPolicyVersion,
          syncPolicyJson,
          source.enabledByDefault ? 1 : 0,
          source.supportStatus,
          source.supportNote,
          now,
          now,
        );
      }
    }
  })();
}
