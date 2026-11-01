CREATE TABLE job_sources_next (
 id TEXT PRIMARY KEY NOT NULL,
 company_id TEXT REFERENCES companies(id) ON DELETE RESTRICT,
 channel_id TEXT REFERENCES source_channels(id) ON DELETE RESTRICT,
 slug TEXT NOT NULL UNIQUE, adapter_key TEXT NOT NULL UNIQUE,
 coverage_role TEXT DEFAULT 'required' CHECK (coverage_role IN ('required','supplemental')),
 base_url TEXT NOT NULL, config_json TEXT NOT NULL DEFAULT '{}',
 sync_policy_version TEXT NOT NULL, sync_policy_json TEXT NOT NULL,
 enabled INTEGER NOT NULL CHECK (enabled IN (0,1)),
 support_status TEXT NOT NULL CHECK (support_status IN ('experimental','supported','blocked')),
 support_note TEXT,
 health_status TEXT NOT NULL CHECK (health_status IN ('unknown','healthy','degraded','unhealthy')),
 consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
 probe_status TEXT, last_probe_at INTEGER, probe_error_category TEXT,
 probe_diagnostics_json TEXT NOT NULL DEFAULT '{}',
 last_success_at INTEGER, last_failure_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 source_kind TEXT NOT NULL DEFAULT 'official' CHECK (source_kind IN ('official','platform')),
 provider_key TEXT,
 CHECK ((source_kind='official' AND company_id IS NOT NULL AND channel_id IS NOT NULL AND coverage_role IS NOT NULL AND provider_key IS NULL)
 OR (source_kind='platform' AND company_id IS NULL AND channel_id IS NULL AND coverage_role IS NULL AND provider_key IS NOT NULL))
);
--> statement-breakpoint
INSERT INTO job_sources_next SELECT *, 'official', NULL FROM job_sources;
--> statement-breakpoint
DROP TABLE job_sources;
--> statement-breakpoint
ALTER TABLE job_sources_next RENAME TO job_sources;
--> statement-breakpoint
CREATE TRIGGER job_sources_platform_no_sync BEFORE INSERT ON sync_runs
WHEN (SELECT source_kind FROM job_sources WHERE id=NEW.source_id)='platform'
BEGIN SELECT RAISE(ABORT, 'platform sources cannot run official sync'); END;
--> statement-breakpoint
CREATE TRIGGER job_sources_company_insert BEFORE INSERT ON job_sources
WHEN NEW.source_kind='official' AND NOT EXISTS (SELECT 1 FROM source_channels WHERE id=NEW.channel_id AND company_id=NEW.company_id)
BEGIN SELECT RAISE(ABORT, 'source channel company mismatch'); END;
--> statement-breakpoint
CREATE TRIGGER job_sources_company_update BEFORE UPDATE ON job_sources
WHEN NEW.source_kind='official' AND NOT EXISTS (SELECT 1 FROM source_channels WHERE id=NEW.channel_id AND company_id=NEW.company_id)
BEGIN SELECT RAISE(ABORT, 'source channel company mismatch'); END;
--> statement-breakpoint
CREATE TABLE platform_connections (
 provider_key TEXT PRIMARY KEY NOT NULL CHECK(provider_key='boss'),
 generation INTEGER NOT NULL CHECK(generation>=1),
 status TEXT NOT NULL CHECK(status IN ('disconnected','connected','available','unavailable','access_blocked','rate_limited')),
 updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE company_external_identities (
 provider_key TEXT NOT NULL, external_company_id TEXT NOT NULL,
 company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
 PRIMARY KEY(provider_key,external_company_id)
);
--> statement-breakpoint
ALTER TABLE jobs ADD COLUMN last_interacted_at INTEGER;
--> statement-breakpoint
CREATE TABLE job_observations_next (
 job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
 sync_run_id TEXT REFERENCES sync_runs(id) ON DELETE RESTRICT,
 job_revision_id TEXT NOT NULL REFERENCES job_revisions(id) ON DELETE RESTRICT,
 observed_at INTEGER NOT NULL,
 platform_task_id TEXT REFERENCES tasks(id) ON DELETE RESTRICT,
 CHECK ((sync_run_id IS NOT NULL AND platform_task_id IS NULL) OR (sync_run_id IS NULL AND platform_task_id IS NOT NULL)),
 UNIQUE(job_id,sync_run_id), UNIQUE(job_id,platform_task_id)
);
--> statement-breakpoint
INSERT INTO job_observations_next SELECT *, NULL FROM job_observations;
--> statement-breakpoint
DROP TABLE job_observations;
--> statement-breakpoint
ALTER TABLE job_observations_next RENAME TO job_observations;
--> statement-breakpoint
CREATE INDEX job_observations_revision_idx ON job_observations(job_revision_id,observed_at DESC);
