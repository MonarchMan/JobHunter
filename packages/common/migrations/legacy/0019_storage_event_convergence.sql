CREATE TABLE `files` (
  `id` text PRIMARY KEY NOT NULL,
  `kind` text NOT NULL,
  `name` text NOT NULL CHECK (length(trim(`name`)) > 0),
  `state` text NOT NULL,
  `revision` integer NOT NULL DEFAULT 0 CHECK (`revision` >= 0),
  `properties_json` text NOT NULL DEFAULT '{}',
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `files_kind_updated_idx` ON `files` (`kind`, `updated_at` DESC);
--> statement-breakpoint
CREATE TABLE `entities` (
  `id` text PRIMARY KEY NOT NULL,
  `relative_path` text NOT NULL UNIQUE,
  `media_type` text NOT NULL,
  `sha256` text NOT NULL CHECK (length(`sha256`) = 64),
  `byte_size` integer NOT NULL CHECK (`byte_size` >= 0),
  `created_at` integer NOT NULL,
  `deleted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `entities_active_sha256_idx`
  ON `entities` (`sha256`) WHERE `deleted_at` IS NULL;
--> statement-breakpoint
CREATE TABLE `file_entity_mappings` (
  `file_id` text NOT NULL REFERENCES `files`(`id`) ON DELETE CASCADE,
  `entity_id` text NOT NULL REFERENCES `entities`(`id`) ON DELETE RESTRICT,
  `version_no` integer NOT NULL CHECK (`version_no` BETWEEN 1 AND 5),
  `parser_version` text,
  `parse_status` text,
  `extracted_text` text,
  `normalized_text` text,
  `error_summary` text,
  `metadata_json` text NOT NULL DEFAULT '{}',
  `created_at` integer NOT NULL,
  PRIMARY KEY (`file_id`, `version_no`),
  UNIQUE (`file_id`, `entity_id`)
);
--> statement-breakpoint
CREATE INDEX `file_entity_mappings_entity_idx`
  ON `file_entity_mappings` (`entity_id`, `file_id`);
--> statement-breakpoint
CREATE TABLE `events` (
  `id` text PRIMARY KEY NOT NULL,
  `stream_type` text NOT NULL,
  `stream_id` text NOT NULL,
  `sequence_no` integer NOT NULL CHECK (`sequence_no` >= 1),
  `event_type` text NOT NULL,
  `payload_json` text NOT NULL DEFAULT '{}',
  `occurred_at` integer NOT NULL,
  UNIQUE (`stream_type`, `stream_id`, `sequence_no`)
);
--> statement-breakpoint
CREATE INDEX `events_stream_occurred_idx`
  ON `events` (`stream_type`, `stream_id`, `occurred_at` DESC);
--> statement-breakpoint
CREATE INDEX `events_type_occurred_idx`
  ON `events` (`event_type`, `occurred_at` DESC);
--> statement-breakpoint
ALTER TABLE `tasks` ADD COLUMN `result_json` text;
--> statement-breakpoint
CREATE TEMP TABLE `legacy_entity_map` (
  `artifact_id` text PRIMARY KEY NOT NULL,
  `entity_id` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `legacy_entity_map` (`artifact_id`, `entity_id`)
SELECT `id`, CASE
  WHEN `deleted_at` IS NULL THEN (
    SELECT MIN(`canonical`.`id`) FROM `file_artifacts` AS `canonical`
    WHERE `canonical`.`sha256` = `artifact`.`sha256` AND `canonical`.`deleted_at` IS NULL
  )
  ELSE `id`
END
FROM `file_artifacts` AS `artifact`;
--> statement-breakpoint
INSERT INTO `entities`
  (`id`, `relative_path`, `media_type`, `sha256`, `byte_size`, `created_at`, `deleted_at`)
SELECT `id`, `relative_path`, `media_type`, `sha256`, `byte_size`, `created_at`, `deleted_at`
FROM `file_artifacts` AS `artifact`
WHERE `deleted_at` IS NOT NULL
   OR `id` = (
     SELECT MIN(`canonical`.`id`) FROM `file_artifacts` AS `canonical`
     WHERE `canonical`.`sha256` = `artifact`.`sha256` AND `canonical`.`deleted_at` IS NULL
   );
--> statement-breakpoint
INSERT INTO `files`
  (`id`, `kind`, `name`, `state`, `revision`, `properties_json`, `created_at`, `updated_at`)
SELECT `id`, 'resume', 'resume-' || `id`, `parse_status`, 0, '{}', `created_at`, `created_at`
FROM `resume_documents`;
--> statement-breakpoint
INSERT INTO `file_entity_mappings`
  (`file_id`, `entity_id`, `version_no`, `parser_version`, `parse_status`, `extracted_text`,
   `normalized_text`, `error_summary`, `metadata_json`, `created_at`)
SELECT `document`.`id`, `mapping`.`entity_id`, 1, `document`.`parser_version`,
       `document`.`parse_status`, `document`.`extracted_text`, NULL, `document`.`error_summary`,
       '{}', `document`.`created_at`
FROM `resume_documents` AS `document`
JOIN `legacy_entity_map` AS `mapping` ON `mapping`.`artifact_id` = `document`.`artifact_id`;
--> statement-breakpoint
INSERT OR IGNORE INTO `files`
  (`id`, `kind`, `name`, `state`, `revision`, `properties_json`, `created_at`, `updated_at`)
SELECT `id`, 'interview_experience', `file_name`, `status`, `revision`,
       json_object(
         'sourceMode', `source_mode`,
         'templateVersion', `template_version`,
         'warnings', json(`warnings_json`),
         'acceptedAt', `accepted_at`
       ),
       `created_at`, `updated_at`
FROM `experience_documents`;
--> statement-breakpoint
INSERT OR IGNORE INTO `file_entity_mappings`
  (`file_id`, `entity_id`, `version_no`, `parser_version`, `parse_status`, `extracted_text`,
   `normalized_text`, `error_summary`, `metadata_json`, `created_at`)
SELECT `document`.`id`, `mapping`.`entity_id`, 1, `document`.`parser_version`, 'parsed',
       `document`.`extracted_text`, `document`.`normalized_text`, NULL, '{}', `document`.`created_at`
FROM `experience_documents` AS `document`
JOIN `legacy_entity_map` AS `mapping` ON `mapping`.`artifact_id` = `document`.`artifact_id`;
--> statement-breakpoint
INSERT OR IGNORE INTO `files`
  (`id`, `kind`, `name`, `state`, `revision`, `properties_json`, `created_at`, `updated_at`)
SELECT `dossier`.`latest_notebook_artifact_id`, 'project_notebook',
       'project-notebook-' || `dossier`.`id`, 'stored', `dossier`.`revision`,
       json_object('sourceHash', `dossier`.`notebook_source_hash`),
       `dossier`.`created_at`, `dossier`.`updated_at`
FROM `project_dossiers` AS `dossier`
WHERE `dossier`.`latest_notebook_artifact_id` IS NOT NULL;
--> statement-breakpoint
INSERT OR IGNORE INTO `file_entity_mappings`
  (`file_id`, `entity_id`, `version_no`, `metadata_json`, `created_at`)
SELECT `dossier`.`latest_notebook_artifact_id`, `mapping`.`entity_id`, 1,
       json_object('sourceHash', `dossier`.`notebook_source_hash`), `dossier`.`updated_at`
FROM `project_dossiers` AS `dossier`
JOIN `legacy_entity_map` AS `mapping`
  ON `mapping`.`artifact_id` = `dossier`.`latest_notebook_artifact_id`;
--> statement-breakpoint
INSERT INTO `files`
  (`id`, `kind`, `name`, `state`, `revision`, `properties_json`, `created_at`, `updated_at`)
SELECT 'legacy-artifact:' || `artifact`.`id`, `artifact`.`kind`,
       'legacy-artifact-' || `artifact`.`id`, 'stored', 0, '{}',
       `artifact`.`created_at`, `artifact`.`created_at`
FROM `file_artifacts` AS `artifact`
JOIN `legacy_entity_map` AS `mapping` ON `mapping`.`artifact_id` = `artifact`.`id`
WHERE `artifact`.`kind` <> 'raw_job'
  AND `artifact`.`deleted_at` IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM `file_entity_mappings` AS `mapping_row`
    WHERE `mapping_row`.`entity_id` = `mapping`.`entity_id`
  );
--> statement-breakpoint
INSERT INTO `file_entity_mappings`
  (`file_id`, `entity_id`, `version_no`, `metadata_json`, `created_at`)
SELECT 'legacy-artifact:' || `artifact`.`id`, `mapping`.`entity_id`, 1, '{}', `artifact`.`created_at`
FROM `file_artifacts` AS `artifact`
JOIN `legacy_entity_map` AS `mapping` ON `mapping`.`artifact_id` = `artifact`.`id`
WHERE EXISTS (
  SELECT 1 FROM `files` WHERE `files`.`id` = 'legacy-artifact:' || `artifact`.`id`
);
--> statement-breakpoint
INSERT INTO `events`
  (`id`, `stream_type`, `stream_id`, `sequence_no`, `event_type`, `payload_json`, `occurred_at`)
SELECT 'legacy-job:' || `id`, 'job', `job_id`,
       row_number() OVER (PARTITION BY `job_id` ORDER BY `created_at`, `id`),
       'job.status.changed',
       json_object(
         'syncRunId', `sync_run_id`, 'fromStatus', `from_status`, 'toStatus', `to_status`,
         'reasonCode', `reason_code`, 'evidence', json_remove(json(`evidence_json`), '$.rawRecordId')
       ),
       `created_at`
FROM `job_status_events`;
--> statement-breakpoint
INSERT INTO `events`
  (`id`, `stream_type`, `stream_id`, `sequence_no`, `event_type`, `payload_json`, `occurred_at`)
SELECT 'legacy-sync:' || `failure`.`id`, 'sync_run', `failure`.`sync_run_id`,
       row_number() OVER (
         PARTITION BY `failure`.`sync_run_id` ORDER BY `failure`.`created_at`, `failure`.`id`
       ),
       'sync.item.failed',
       json_object(
         'sourceId', `failure`.`source_id`, 'externalJobId', `failure`.`external_job_id`,
         'sourceUrl', `raw`.`source_url`, 'stage', `failure`.`stage`,
         'errorCategory', `failure`.`error_category`, 'errorSummary', `failure`.`error_summary`
       ),
       `failure`.`created_at`
FROM `sync_item_failures` AS `failure`
JOIN `raw_job_records` AS `raw` ON `raw`.`id` = `failure`.`raw_record_id`;
--> statement-breakpoint
INSERT INTO `events`
  (`id`, `stream_type`, `stream_id`, `sequence_no`, `event_type`, `payload_json`, `occurred_at`)
SELECT 'legacy-agent:' || `call`.`id`, 'agent_run', `call`.`agent_run_id`,
       `call`.`sequence_no` + 1, 'agent.tool.finished',
       json_object(
         'toolKey', `call`.`tool_key`, 'inputSummary', json(`call`.`input_summary_json`),
         'outputSummary', CASE WHEN `call`.`output_summary_json` IS NULL THEN NULL
                               ELSE json(`call`.`output_summary_json`) END,
         'status', `call`.`status`, 'durationMs', `call`.`duration_ms`,
         'errorSummary', `call`.`error_summary`
       ),
       COALESCE(`run`.`finished_at`, `run`.`started_at`)
FROM `agent_tool_calls` AS `call`
JOIN `agent_runs` AS `run` ON `run`.`id` = `call`.`agent_run_id`;
--> statement-breakpoint
INSERT INTO `events`
  (`id`, `stream_type`, `stream_id`, `sequence_no`, `event_type`, `payload_json`, `occurred_at`)
SELECT 'legacy-operation:' || `event_key`, 'operation', `subject_hash`,
       row_number() OVER (PARTITION BY `subject_hash` ORDER BY `created_at`, `event_key`),
       `event_type`, json_object('subjectHash', `subject_hash`, 'details', json(`details_json`)),
       `created_at`
FROM `operation_audit_events`;
--> statement-breakpoint
CREATE TABLE `job_revisions_new` (
  `id` text PRIMARY KEY NOT NULL,
  `job_id` text NOT NULL REFERENCES `jobs`(`id`) ON DELETE CASCADE,
  `revision_no` integer NOT NULL CHECK (`revision_no` >= 1),
  `content_hash` text NOT NULL,
  `normalizer_version` text NOT NULL,
  `source_payload_hash` text NOT NULL CHECK (length(`source_payload_hash`) = 64),
  `source_url` text NOT NULL,
  `snapshot_json` text NOT NULL,
  `change_set_json` text NOT NULL,
  `created_at` integer NOT NULL,
  UNIQUE (`job_id`, `revision_no`),
  UNIQUE (`job_id`, `content_hash`)
);
--> statement-breakpoint
INSERT INTO `job_revisions_new`
  (`id`, `job_id`, `revision_no`, `content_hash`, `normalizer_version`,
   `source_payload_hash`, `source_url`, `snapshot_json`, `change_set_json`, `created_at`)
SELECT `revision`.`id`, `revision`.`job_id`, `revision`.`revision_no`, `revision`.`content_hash`,
       `revision`.`normalizer_version`, `raw`.`content_hash`, `raw`.`source_url`,
       `revision`.`snapshot_json`, `revision`.`change_set_json`, `revision`.`created_at`
FROM `job_revisions` AS `revision`
JOIN `raw_job_records` AS `raw` ON `raw`.`id` = `revision`.`raw_record_id`;
--> statement-breakpoint
CREATE TABLE `job_observations_new` (
  `job_id` text NOT NULL REFERENCES `jobs`(`id`) ON DELETE CASCADE,
  `sync_run_id` text NOT NULL REFERENCES `sync_runs`(`id`) ON DELETE RESTRICT,
  `job_revision_id` text NOT NULL REFERENCES `job_revisions_new`(`id`) ON DELETE RESTRICT,
  `observed_at` integer NOT NULL,
  PRIMARY KEY (`job_id`, `sync_run_id`)
);
--> statement-breakpoint
INSERT INTO `job_observations_new`
  (`job_id`, `sync_run_id`, `job_revision_id`, `observed_at`)
SELECT `observation`.`job_id`, `observation`.`sync_run_id`,
       COALESCE(
         (
           SELECT `revision`.`id` FROM `job_revisions` AS `revision`
           WHERE `revision`.`job_id` = `observation`.`job_id`
             AND `revision`.`raw_record_id` = `observation`.`raw_record_id`
           ORDER BY `revision`.`revision_no` DESC LIMIT 1
         ),
         (
           SELECT `revision`.`id` FROM `job_revisions` AS `revision`
           WHERE `revision`.`job_id` = `observation`.`job_id`
             AND `revision`.`created_at` <= `observation`.`observed_at`
           ORDER BY `revision`.`revision_no` DESC LIMIT 1
         ),
         (
           SELECT `revision`.`id` FROM `job_revisions` AS `revision`
           WHERE `revision`.`job_id` = `observation`.`job_id`
           ORDER BY `revision`.`revision_no` ASC LIMIT 1
         )
       ),
       `observation`.`observed_at`
FROM `job_observations` AS `observation`;
--> statement-breakpoint
DROP TABLE `job_observations`;
--> statement-breakpoint
DROP TABLE `job_revisions`;
--> statement-breakpoint
ALTER TABLE `job_revisions_new` RENAME TO `job_revisions`;
--> statement-breakpoint
ALTER TABLE `job_observations_new` RENAME TO `job_observations`;
--> statement-breakpoint
CREATE INDEX `job_observations_revision_idx`
  ON `job_observations` (`job_revision_id`, `observed_at` DESC);
--> statement-breakpoint
CREATE TABLE `profile_versions_new` (
  `id` text PRIMARY KEY NOT NULL,
  `profile_id` text NOT NULL REFERENCES `candidate_profiles`(`id`) ON DELETE CASCADE,
  `version_no` integer NOT NULL CHECK (`version_no` >= 1),
  `resume_file_id` text REFERENCES `files`(`id`) ON DELETE RESTRICT,
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
INSERT INTO `profile_versions_new`
SELECT `id`, `profile_id`, `version_no`, `resume_document_id`, `agent_run_id`, `extracted_json`,
       `effective_json`, `locked_paths_json`, `content_hash`, `is_current`, `created_at`
FROM `profile_versions`;
--> statement-breakpoint
DROP TABLE `resume_polish_suggestions`;
--> statement-breakpoint
DROP TABLE `profile_versions`;
--> statement-breakpoint
ALTER TABLE `profile_versions_new` RENAME TO `profile_versions`;
--> statement-breakpoint
CREATE UNIQUE INDEX `profile_versions_one_current_idx`
  ON `profile_versions` (`profile_id`) WHERE `is_current` = 1;
--> statement-breakpoint
CREATE TABLE `project_dossiers_new` (
  `id` text PRIMARY KEY NOT NULL,
  `snapshot_id` text NOT NULL UNIQUE REFERENCES `resume_project_snapshots`(`id`) ON DELETE RESTRICT,
  `notebook_file_id` text REFERENCES `files`(`id`) ON DELETE RESTRICT,
  `notebook_source_hash` text CHECK (`notebook_source_hash` IS NULL OR length(`notebook_source_hash`) = 64),
  `revision` integer NOT NULL DEFAULT 0 CHECK (`revision` >= 0),
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `project_dossiers_new`
SELECT `id`, `snapshot_id`, `latest_notebook_artifact_id`, `notebook_source_hash`,
       `revision`, `created_at`, `updated_at`
FROM `project_dossiers`;
--> statement-breakpoint
DROP TABLE `project_dossiers`;
--> statement-breakpoint
ALTER TABLE `project_dossiers_new` RENAME TO `project_dossiers`;
--> statement-breakpoint
CREATE INDEX `project_dossiers_updated_idx` ON `project_dossiers` (`updated_at` DESC);
--> statement-breakpoint
CREATE TABLE `interview_experiences_new` (
  `id` text PRIMARY KEY NOT NULL,
  `file_id` text NOT NULL REFERENCES `files`(`id`) ON DELETE CASCADE,
  `sequence_no` integer NOT NULL CHECK (`sequence_no` >= 1),
  `company` text,
  `role` text,
  `stage` text,
  `occurred_on` text CHECK (`occurred_on` IS NULL OR `occurred_on` GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  `outcome` text,
  `difficulty` text,
  `tags_json` text NOT NULL DEFAULT '[]',
  `notes` text,
  UNIQUE (`file_id`, `sequence_no`)
);
--> statement-breakpoint
INSERT INTO `interview_experiences_new`
SELECT `id`, `document_id`, `sequence_no`, `company`, `role`, `stage`, `occurred_on`, `outcome`,
       `difficulty`, `tags_json`, `notes`
FROM `interview_experiences`;
--> statement-breakpoint
CREATE TABLE `interview_question_entries_new` (
  `id` text PRIMARY KEY NOT NULL,
  `experience_id` text NOT NULL REFERENCES `interview_experiences_new`(`id`) ON DELETE CASCADE,
  `sequence_no` integer NOT NULL CHECK (`sequence_no` >= 1),
  `question` text NOT NULL CHECK (length(trim(`question`)) > 0),
  `answer` text,
  `reflection` text,
  `question_source_start` integer,
  `question_source_end` integer,
  `answer_source_start` integer,
  `answer_source_end` integer,
  UNIQUE (`experience_id`, `sequence_no`),
  CHECK ((`question_source_start` IS NULL AND `question_source_end` IS NULL) OR (`question_source_start` >= 0 AND `question_source_end` > `question_source_start`)),
  CHECK ((`answer_source_start` IS NULL AND `answer_source_end` IS NULL) OR (`answer_source_start` >= 0 AND `answer_source_end` > `answer_source_start`))
);
--> statement-breakpoint
INSERT INTO `interview_question_entries_new` SELECT * FROM `interview_question_entries`;
--> statement-breakpoint
DROP TABLE `interview_question_entries`;
--> statement-breakpoint
DROP TABLE `interview_experiences`;
--> statement-breakpoint
ALTER TABLE `interview_experiences_new` RENAME TO `interview_experiences`;
--> statement-breakpoint
ALTER TABLE `interview_question_entries_new` RENAME TO `interview_question_entries`;
--> statement-breakpoint
CREATE INDEX `interview_experiences_company_role_idx`
  ON `interview_experiences` (`company`, `role`, `occurred_on` DESC);
--> statement-breakpoint
CREATE INDEX `interview_question_entries_experience_idx`
  ON `interview_question_entries` (`experience_id`, `sequence_no`);
--> statement-breakpoint
CREATE TABLE `job_sources_new` (
  `id` text PRIMARY KEY NOT NULL,
  `company_id` text NOT NULL REFERENCES `companies`(`id`) ON DELETE RESTRICT,
  `channel_id` text NOT NULL REFERENCES `source_channels`(`id`) ON DELETE RESTRICT,
  `slug` text NOT NULL UNIQUE,
  `adapter_key` text NOT NULL UNIQUE,
  `coverage_role` text NOT NULL DEFAULT 'required'
    CHECK (`coverage_role` IN ('required', 'supplemental')),
  `base_url` text NOT NULL,
  `config_json` text NOT NULL DEFAULT '{}',
  `sync_policy_version` text NOT NULL,
  `sync_policy_json` text NOT NULL,
  `enabled` integer NOT NULL CHECK (`enabled` IN (0, 1)),
  `support_status` text NOT NULL
    CHECK (`support_status` IN ('experimental', 'supported', 'blocked')),
  `support_note` text,
  `health_status` text NOT NULL
    CHECK (`health_status` IN ('unknown', 'healthy', 'degraded', 'unhealthy')),
  `consecutive_failures` integer NOT NULL DEFAULT 0 CHECK (`consecutive_failures` >= 0),
  `probe_status` text,
  `last_probe_at` integer,
  `probe_error_category` text,
  `probe_diagnostics_json` text NOT NULL DEFAULT '{}',
  `last_success_at` integer,
  `last_failure_at` integer,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `job_sources_new`
  (`id`, `company_id`, `channel_id`, `slug`, `adapter_key`, `coverage_role`, `base_url`,
   `config_json`, `sync_policy_version`, `sync_policy_json`, `enabled`, `support_status`,
   `support_note`, `health_status`, `consecutive_failures`, `probe_status`, `last_probe_at`,
   `probe_error_category`, `probe_diagnostics_json`, `last_success_at`, `last_failure_at`,
   `created_at`, `updated_at`)
SELECT `id`, `company_id`, `channel_id`, `slug`, `adapter_key`, `coverage_role`, `base_url`,
       `config_json`, `sync_policy_version`, `sync_policy_json`, `enabled`, `support_status`,
       `support_note`, `health_status`, `consecutive_failures`, `probe_status`, `last_probe_at`,
       `probe_error_category`, `probe_diagnostics_json`, `last_success_at`, `last_failure_at`,
       `created_at`, `updated_at`
FROM `job_sources`;
--> statement-breakpoint
DROP TABLE `job_sources`;
--> statement-breakpoint
ALTER TABLE `job_sources_new` RENAME TO `job_sources`;
--> statement-breakpoint
DROP TRIGGER `jobs_fts_insert`;
--> statement-breakpoint
DROP TRIGGER `jobs_fts_delete`;
--> statement-breakpoint
DROP TRIGGER `jobs_fts_update`;
--> statement-breakpoint
DROP TABLE `jobs_fts`;
--> statement-breakpoint
DROP TABLE `job_status_events`;
--> statement-breakpoint
DROP TABLE `sync_item_failures`;
--> statement-breakpoint
DROP TABLE `agent_tool_calls`;
--> statement-breakpoint
DROP TABLE `operation_audit_events`;
--> statement-breakpoint
DROP TABLE `resume_documents`;
--> statement-breakpoint
DROP TABLE `experience_documents`;
--> statement-breakpoint
DROP TABLE `raw_job_records`;
--> statement-breakpoint
DROP TABLE `file_artifacts`;
--> statement-breakpoint
DELETE FROM `entities`
WHERE NOT EXISTS (
  SELECT 1 FROM `file_entity_mappings` AS `mapping`
  WHERE `mapping`.`entity_id` = `entities`.`id`
);
--> statement-breakpoint
DROP TABLE `legacy_entity_map`;
