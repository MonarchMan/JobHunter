ALTER TABLE `sync_runs` ADD `coverage_evidence_json` text NOT NULL DEFAULT '{}';
--> statement-breakpoint
ALTER TABLE `job_sources` ADD `probe_status` text;
--> statement-breakpoint
ALTER TABLE `job_sources` ADD `last_probe_at` integer;
--> statement-breakpoint
ALTER TABLE `job_sources` ADD `probe_error_category` text;
--> statement-breakpoint
ALTER TABLE `job_sources` ADD `probe_diagnostics_json` text NOT NULL DEFAULT '{}';
--> statement-breakpoint
CREATE TABLE `source_job_details` (
  `source_id` text NOT NULL REFERENCES `job_sources`(`id`) ON DELETE CASCADE,
  `external_job_id` text NOT NULL,
  `list_content_hash` text NOT NULL,
  `adapter_version` text NOT NULL,
  `status` text NOT NULL CHECK (`status` IN ('succeeded', 'failed')),
  `detail_json` text,
  `error_category` text,
  `error_summary` text,
  `fetched_at` integer,
  `updated_at` integer NOT NULL,
  PRIMARY KEY (`source_id`, `external_job_id`)
);
--> statement-breakpoint
CREATE TABLE `sync_item_failures` (
  `id` text PRIMARY KEY NOT NULL,
  `sync_run_id` text NOT NULL REFERENCES `sync_runs`(`id`) ON DELETE CASCADE,
  `source_id` text NOT NULL REFERENCES `job_sources`(`id`) ON DELETE CASCADE,
  `external_job_id` text NOT NULL,
  `stage` text NOT NULL,
  `error_category` text NOT NULL,
  `error_summary` text NOT NULL,
  `raw_record_id` text NOT NULL REFERENCES `raw_job_records`(`id`) ON DELETE RESTRICT,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sync_item_failures_run_idx` ON `sync_item_failures` (`sync_run_id`, `created_at`);
--> statement-breakpoint
UPDATE `job_sources`
SET `sync_policy_version` = 'v2',
    `sync_policy_json` = json_set(
      `sync_policy_json`,
      '$.degradedAfterFailures', 2,
      '$.unhealthyAfterFailures', 4
    );
