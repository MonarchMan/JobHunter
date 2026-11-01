CREATE TABLE `companies` (
  `id` text PRIMARY KEY NOT NULL,
  `slug` text NOT NULL UNIQUE,
  `name` text NOT NULL,
  `aliases_json` text NOT NULL DEFAULT '[]',
  `industry` text,
  `size_tag` text,
  `enabled` integer NOT NULL CHECK (`enabled` IN (0, 1)),
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `job_sources` (
  `id` text PRIMARY KEY NOT NULL,
  `company_id` text NOT NULL REFERENCES `companies`(`id`) ON DELETE RESTRICT,
  `slug` text NOT NULL UNIQUE,
  `adapter_key` text NOT NULL,
  `recruitment_type` text NOT NULL CHECK (`recruitment_type` IN ('social', 'campus', 'mixed')),
  `base_url` text NOT NULL,
  `config_json` text NOT NULL DEFAULT '{}',
  `sync_policy_version` text NOT NULL,
  `sync_policy_json` text NOT NULL,
  `enabled` integer NOT NULL CHECK (`enabled` IN (0, 1)),
  `support_status` text NOT NULL CHECK (`support_status` IN ('experimental', 'supported', 'blocked')),
  `support_note` text,
  `health_status` text NOT NULL CHECK (`health_status` IN ('unknown', 'healthy', 'degraded', 'unhealthy')),
  `consecutive_failures` integer NOT NULL DEFAULT 0 CHECK (`consecutive_failures` >= 0),
  `last_success_at` integer,
  `last_failure_at` integer,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  UNIQUE (`company_id`, `recruitment_type`, `adapter_key`)
);
--> statement-breakpoint
CREATE TABLE `sync_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `source_id` text NOT NULL REFERENCES `job_sources`(`id`) ON DELETE RESTRICT,
  `trigger` text NOT NULL CHECK (`trigger` IN ('manual', 'schedule', 'retry')),
  `status` text NOT NULL CHECK (`status` IN ('running', 'succeeded', 'partial', 'failed', 'cancelled')),
  `coverage` text NOT NULL CHECK (`coverage` IN ('complete', 'partial', 'unknown')),
  `adapter_version` text NOT NULL,
  `normalizer_version` text NOT NULL,
  `sync_policy_version` text NOT NULL,
  `source_config_hash` text NOT NULL,
  `cursor_in_json` text,
  `cursor_out_json` text,
  `stats_json` text NOT NULL DEFAULT '{}',
  `error_category` text,
  `error_summary` text,
  `started_at` integer NOT NULL,
  `finished_at` integer
);
--> statement-breakpoint
CREATE INDEX `sync_runs_source_started_idx` ON `sync_runs` (`source_id`, `started_at` DESC);
--> statement-breakpoint
CREATE INDEX `sync_runs_status_started_idx` ON `sync_runs` (`status`, `started_at` DESC);
--> statement-breakpoint
CREATE UNIQUE INDEX `sync_runs_one_running_per_source_idx` ON `sync_runs` (`source_id`) WHERE `status` = 'running';
--> statement-breakpoint
CREATE TABLE `file_artifacts` (
  `id` text PRIMARY KEY NOT NULL,
  `kind` text NOT NULL CHECK (`kind` IN ('raw_job', 'resume', 'export', 'fixture_candidate')),
  `relative_path` text NOT NULL UNIQUE,
  `media_type` text NOT NULL,
  `sha256` text NOT NULL CHECK (length(`sha256`) = 64),
  `byte_size` integer NOT NULL CHECK (`byte_size` >= 0),
  `created_at` integer NOT NULL,
  `deleted_at` integer
);
--> statement-breakpoint
CREATE INDEX `file_artifacts_sha256_idx` ON `file_artifacts` (`sha256`);
--> statement-breakpoint
CREATE TABLE `raw_job_records` (
  `id` text PRIMARY KEY NOT NULL,
  `source_id` text NOT NULL REFERENCES `job_sources`(`id`) ON DELETE RESTRICT,
  `first_sync_run_id` text NOT NULL REFERENCES `sync_runs`(`id`) ON DELETE RESTRICT,
  `external_job_id` text,
  `identity_key` text NOT NULL,
  `source_url` text NOT NULL,
  `content_hash` text NOT NULL,
  `payload_json` text,
  `artifact_id` text REFERENCES `file_artifacts`(`id`) ON DELETE RESTRICT,
  `captured_at` integer NOT NULL,
  CHECK (`payload_json` IS NOT NULL OR `artifact_id` IS NOT NULL),
  UNIQUE (`source_id`, `identity_key`, `content_hash`)
);
--> statement-breakpoint
CREATE TABLE `jobs` (
  `id` text PRIMARY KEY NOT NULL,
  `company_id` text NOT NULL REFERENCES `companies`(`id`) ON DELETE RESTRICT,
  `source_id` text NOT NULL REFERENCES `job_sources`(`id`) ON DELETE RESTRICT,
  `external_job_id` text NOT NULL,
  `title` text NOT NULL,
  `department` text,
  `job_family` text,
  `locations_json` text NOT NULL DEFAULT '[]',
  `employment_type` text,
  `experience_text` text,
  `education_text` text,
  `description` text NOT NULL,
  `detail_url` text NOT NULL,
  `apply_url` text NOT NULL,
  `published_at` integer,
  `status` text NOT NULL CHECK (`status` IN ('active', 'stale', 'closed')),
  `missing_count` integer NOT NULL DEFAULT 0 CHECK (`missing_count` >= 0),
  `content_hash` text NOT NULL,
  `first_seen_at` integer NOT NULL,
  `last_seen_at` integer NOT NULL,
  `closed_at` integer,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  UNIQUE (`source_id`, `external_job_id`)
);
--> statement-breakpoint
CREATE INDEX `jobs_status_updated_idx` ON `jobs` (`status`, `updated_at` DESC);
--> statement-breakpoint
CREATE INDEX `jobs_company_status_updated_idx` ON `jobs` (`company_id`, `status`, `updated_at` DESC);
--> statement-breakpoint
CREATE INDEX `jobs_family_status_idx` ON `jobs` (`job_family`, `status`);
--> statement-breakpoint
CREATE INDEX `jobs_published_idx` ON `jobs` (`published_at`);
--> statement-breakpoint
CREATE VIRTUAL TABLE `jobs_fts` USING fts5(`title`, `department`, `description`, content='jobs', content_rowid='rowid', tokenize='trigram');
--> statement-breakpoint
CREATE TRIGGER `jobs_fts_insert` AFTER INSERT ON `jobs` BEGIN
  INSERT INTO `jobs_fts` (`rowid`, `title`, `department`, `description`) VALUES (new.`rowid`, new.`title`, new.`department`, new.`description`);
END;
--> statement-breakpoint
CREATE TRIGGER `jobs_fts_delete` AFTER DELETE ON `jobs` BEGIN
  INSERT INTO `jobs_fts` (`jobs_fts`, `rowid`, `title`, `department`, `description`) VALUES ('delete', old.`rowid`, old.`title`, old.`department`, old.`description`);
END;
--> statement-breakpoint
CREATE TRIGGER `jobs_fts_update` AFTER UPDATE OF `title`, `department`, `description` ON `jobs` BEGIN
  INSERT INTO `jobs_fts` (`jobs_fts`, `rowid`, `title`, `department`, `description`) VALUES ('delete', old.`rowid`, old.`title`, old.`department`, old.`description`);
  INSERT INTO `jobs_fts` (`rowid`, `title`, `department`, `description`) VALUES (new.`rowid`, new.`title`, new.`department`, new.`description`);
END;
--> statement-breakpoint
CREATE TABLE `job_revisions` (
  `id` text PRIMARY KEY NOT NULL,
  `job_id` text NOT NULL REFERENCES `jobs`(`id`) ON DELETE CASCADE,
  `revision_no` integer NOT NULL CHECK (`revision_no` >= 1),
  `content_hash` text NOT NULL,
  `normalizer_version` text NOT NULL,
  `snapshot_json` text NOT NULL,
  `change_set_json` text NOT NULL,
  `raw_record_id` text NOT NULL REFERENCES `raw_job_records`(`id`) ON DELETE RESTRICT,
  `created_at` integer NOT NULL,
  UNIQUE (`job_id`, `revision_no`),
  UNIQUE (`job_id`, `content_hash`)
);
--> statement-breakpoint
CREATE TABLE `job_observations` (
  `job_id` text NOT NULL REFERENCES `jobs`(`id`) ON DELETE CASCADE,
  `sync_run_id` text NOT NULL REFERENCES `sync_runs`(`id`) ON DELETE RESTRICT,
  `raw_record_id` text NOT NULL REFERENCES `raw_job_records`(`id`) ON DELETE RESTRICT,
  `observed_at` integer NOT NULL,
  PRIMARY KEY (`job_id`, `sync_run_id`)
);
--> statement-breakpoint
CREATE TABLE `job_status_events` (
  `id` text PRIMARY KEY NOT NULL,
  `job_id` text NOT NULL REFERENCES `jobs`(`id`) ON DELETE CASCADE,
  `sync_run_id` text REFERENCES `sync_runs`(`id`) ON DELETE RESTRICT,
  `from_status` text CHECK (`from_status` IS NULL OR `from_status` IN ('active', 'stale', 'closed')),
  `to_status` text NOT NULL CHECK (`to_status` IN ('active', 'stale', 'closed')),
  `reason_code` text NOT NULL,
  `evidence_json` text NOT NULL,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `job_status_events_job_created_idx` ON `job_status_events` (`job_id`, `created_at`);
--> statement-breakpoint
CREATE TABLE `resume_documents` (
  `id` text PRIMARY KEY NOT NULL,
  `artifact_id` text NOT NULL UNIQUE REFERENCES `file_artifacts`(`id`) ON DELETE RESTRICT,
  `content_hash` text NOT NULL UNIQUE,
  `media_type` text NOT NULL,
  `extracted_text` text,
  `parse_status` text NOT NULL CHECK (`parse_status` IN ('pending', 'parsed', 'needs_ocr', 'failed')),
  `parser_version` text,
  `error_summary` text,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `candidate_profiles` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `agent_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `agent_key` text NOT NULL,
  `agent_version` text NOT NULL,
  `prompt_version` text NOT NULL,
  `model_config_hash` text NOT NULL,
  `input_hash` text NOT NULL,
  `cache_key` text NOT NULL,
  `status` text NOT NULL CHECK (`status` IN ('running', 'succeeded', 'failed', 'cancelled')),
  `output_json` text,
  `error_category` text,
  `error_summary` text,
  `input_tokens` integer CHECK (`input_tokens` IS NULL OR `input_tokens` >= 0),
  `output_tokens` integer CHECK (`output_tokens` IS NULL OR `output_tokens` >= 0),
  `estimated_cost_micros` integer CHECK (`estimated_cost_micros` IS NULL OR `estimated_cost_micros` >= 0),
  `cost_currency` text,
  `pricing_version` text,
  `started_at` integer NOT NULL,
  `finished_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_runs_success_cache_idx` ON `agent_runs` (`cache_key`) WHERE `status` = 'succeeded';
--> statement-breakpoint
CREATE TABLE `profile_versions` (
  `id` text PRIMARY KEY NOT NULL,
  `profile_id` text NOT NULL REFERENCES `candidate_profiles`(`id`) ON DELETE CASCADE,
  `version_no` integer NOT NULL CHECK (`version_no` >= 1),
  `resume_document_id` text REFERENCES `resume_documents`(`id`) ON DELETE RESTRICT,
  `agent_run_id` text REFERENCES `agent_runs`(`id`) ON DELETE RESTRICT,
  `extracted_json` text NOT NULL,
  `effective_json` text NOT NULL,
  `locked_paths_json` text NOT NULL DEFAULT '[]',
  `content_hash` text NOT NULL,
  `is_current` integer NOT NULL CHECK (`is_current` IN (0, 1)),
  `created_at` integer NOT NULL,
  UNIQUE (`profile_id`, `version_no`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `profile_versions_one_current_idx` ON `profile_versions` (`profile_id`) WHERE `is_current` = 1;
--> statement-breakpoint
CREATE TABLE `job_enrichments` (
  `id` text PRIMARY KEY NOT NULL,
  `job_revision_id` text NOT NULL REFERENCES `job_revisions`(`id`) ON DELETE RESTRICT,
  `agent_run_id` text NOT NULL REFERENCES `agent_runs`(`id`) ON DELETE RESTRICT,
  `schema_version` text NOT NULL,
  `content_hash` text NOT NULL,
  `result_json` text NOT NULL,
  `created_at` integer NOT NULL,
  UNIQUE (`job_revision_id`, `agent_run_id`)
);
--> statement-breakpoint
CREATE TABLE `match_rulesets` (
  `id` text PRIMARY KEY NOT NULL,
  `version` text NOT NULL UNIQUE,
  `definition_json` text NOT NULL,
  `definition_hash` text NOT NULL UNIQUE,
  `active` integer NOT NULL CHECK (`active` IN (0, 1)),
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `match_rulesets_one_active_idx` ON `match_rulesets` (`active`) WHERE `active` = 1;
--> statement-breakpoint
CREATE TABLE `match_results` (
  `id` text PRIMARY KEY NOT NULL,
  `profile_version_id` text NOT NULL REFERENCES `profile_versions`(`id`) ON DELETE RESTRICT,
  `job_revision_id` text NOT NULL REFERENCES `job_revisions`(`id`) ON DELETE RESTRICT,
  `job_enrichment_id` text REFERENCES `job_enrichments`(`id`) ON DELETE RESTRICT,
  `ruleset_id` text NOT NULL REFERENCES `match_rulesets`(`id`) ON DELETE RESTRICT,
  `filter_status` text NOT NULL CHECK (`filter_status` IN ('eligible', 'excluded', 'uncertain')),
  `total_score` real NOT NULL CHECK (`total_score` >= 0 AND `total_score` <= 100),
  `components_json` text NOT NULL,
  `risks_json` text NOT NULL,
  `input_hash` text NOT NULL UNIQUE,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `match_results_inputs_idx` ON `match_results` (`profile_version_id`, `job_revision_id`, `ruleset_id`);
--> statement-breakpoint
CREATE INDEX `match_results_profile_rank_idx` ON `match_results` (`profile_version_id`, `filter_status`, `total_score` DESC);
--> statement-breakpoint
CREATE TABLE `match_advices` (
  `id` text PRIMARY KEY NOT NULL,
  `match_result_id` text NOT NULL REFERENCES `match_results`(`id`) ON DELETE CASCADE,
  `agent_run_id` text NOT NULL REFERENCES `agent_runs`(`id`) ON DELETE RESTRICT,
  `schema_version` text NOT NULL,
  `content_hash` text NOT NULL,
  `result_json` text NOT NULL,
  `created_at` integer NOT NULL,
  UNIQUE (`match_result_id`, `agent_run_id`)
);
--> statement-breakpoint
CREATE TABLE `agent_tool_calls` (
  `id` text PRIMARY KEY NOT NULL,
  `agent_run_id` text NOT NULL REFERENCES `agent_runs`(`id`) ON DELETE CASCADE,
  `sequence_no` integer NOT NULL CHECK (`sequence_no` >= 0),
  `tool_key` text NOT NULL,
  `input_summary_json` text NOT NULL,
  `output_summary_json` text,
  `status` text NOT NULL CHECK (`status` IN ('running', 'succeeded', 'failed', 'cancelled')),
  `duration_ms` integer CHECK (`duration_ms` IS NULL OR `duration_ms` >= 0),
  `error_summary` text,
  UNIQUE (`agent_run_id`, `sequence_no`)
);
--> statement-breakpoint
CREATE TABLE `schedules` (
  `id` text PRIMARY KEY NOT NULL,
  `schedule_key` text NOT NULL UNIQUE,
  `task_type` text NOT NULL,
  `payload_json` text NOT NULL,
  `cron_expression` text NOT NULL,
  `timezone` text NOT NULL,
  `enabled` integer NOT NULL CHECK (`enabled` IN (0, 1)),
  `next_run_at` integer NOT NULL,
  `last_enqueued_at` integer,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tasks` (
  `id` text PRIMARY KEY NOT NULL,
  `task_type` text NOT NULL,
  `payload_json` text NOT NULL,
  `status` text NOT NULL CHECK (`status` IN ('pending', 'running', 'succeeded', 'failed', 'cancelled')),
  `priority` integer NOT NULL DEFAULT 0,
  `idempotency_key` text NOT NULL UNIQUE,
  `concurrency_key` text,
  `schedule_id` text REFERENCES `schedules`(`id`) ON DELETE RESTRICT,
  `retry_of_task_id` text REFERENCES `tasks`(`id`) ON DELETE RESTRICT,
  `attempt_count` integer NOT NULL DEFAULT 0 CHECK (`attempt_count` >= 0),
  `max_attempts` integer NOT NULL CHECK (`max_attempts` >= 1),
  `available_at` integer NOT NULL,
  `lease_owner` text,
  `lease_expires_at` integer,
  `last_heartbeat_at` integer,
  `cancel_requested_at` integer,
  `error_category` text,
  `error_summary` text,
  `created_at` integer NOT NULL,
  `started_at` integer,
  `finished_at` integer
);
--> statement-breakpoint
CREATE INDEX `tasks_claim_idx` ON `tasks` (`status`, `available_at`, `priority` DESC, `created_at`);
--> statement-breakpoint
CREATE INDEX `tasks_recovery_idx` ON `tasks` (`status`, `lease_expires_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `tasks_active_concurrency_idx` ON `tasks` (`concurrency_key`) WHERE `concurrency_key` IS NOT NULL AND `status` IN ('pending', 'running');
--> statement-breakpoint
CREATE TABLE `application_settings` (
  `key` text PRIMARY KEY NOT NULL,
  `value_json` text NOT NULL,
  `schema_version` text NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `operation_audit_events` (
  `event_key` text PRIMARY KEY NOT NULL,
  `event_type` text NOT NULL,
  `subject_hash` text NOT NULL,
  `details_json` text NOT NULL,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_seen_jobs` (
  `sync_run_id` text NOT NULL REFERENCES `sync_runs`(`id`) ON DELETE CASCADE,
  `job_id` text NOT NULL REFERENCES `jobs`(`id`) ON DELETE CASCADE,
  PRIMARY KEY (`sync_run_id`, `job_id`)
);
