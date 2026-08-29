CREATE TABLE `resume_project_snapshots` (
  `id` text PRIMARY KEY NOT NULL,
  `source_profile_id` text NOT NULL,
  `source_profile_version_id` text NOT NULL,
  `project_index` integer NOT NULL CHECK (`project_index` >= 0),
  `project_json` text NOT NULL,
  `content_hash` text NOT NULL CHECK (length(`content_hash`) = 64),
  `created_at` integer NOT NULL,
  UNIQUE (`source_profile_version_id`, `project_index`, `content_hash`)
);
--> statement-breakpoint
CREATE TABLE `project_dossiers` (
  `id` text PRIMARY KEY NOT NULL,
  `snapshot_id` text NOT NULL UNIQUE REFERENCES `resume_project_snapshots`(`id`) ON DELETE RESTRICT,
  `latest_notebook_artifact_id` text REFERENCES `file_artifacts`(`id`) ON DELETE RESTRICT,
  `notebook_source_hash` text CHECK (`notebook_source_hash` IS NULL OR length(`notebook_source_hash`) = 64),
  `revision` integer NOT NULL DEFAULT 0 CHECK (`revision` >= 0),
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `project_dossiers_updated_idx` ON `project_dossiers` (`updated_at` DESC);
--> statement-breakpoint
CREATE TABLE `drill_sessions` (
  `id` text PRIMARY KEY NOT NULL,
  `dossier_id` text NOT NULL REFERENCES `project_dossiers`(`id`) ON DELETE CASCADE,
  `profile_key` text NOT NULL CHECK (`profile_key` = 'resume-only'),
  `profile_version` text NOT NULL CHECK (`profile_version` = 'v1'),
  `profile_definition_hash` text NOT NULL CHECK (length(`profile_definition_hash`) = 64),
  `capability_summary_json` text NOT NULL,
  `status` text NOT NULL CHECK (`status` IN ('active', 'paused', 'completed')),
  `context_revision` integer NOT NULL DEFAULT 0 CHECK (`context_revision` >= 0),
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `completed_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `drill_sessions_one_open_per_dossier_idx`
  ON `drill_sessions` (`dossier_id`) WHERE `status` IN ('active', 'paused');
--> statement-breakpoint
CREATE TABLE `drill_turns` (
  `id` text PRIMARY KEY NOT NULL,
  `session_id` text NOT NULL REFERENCES `drill_sessions`(`id`) ON DELETE CASCADE,
  `turn_no` integer NOT NULL CHECK (`turn_no` >= 1),
  `status` text NOT NULL CHECK (`status` IN ('question_pending', 'awaiting_answer', 'digest_pending', 'ready', 'skipped', 'cancelled')),
  `context_hash` text NOT NULL CHECK (length(`context_hash`) = 64),
  `question` text,
  `intent` text,
  `primary_dimension` text CHECK (`primary_dimension` IS NULL OR `primary_dimension` IN ('background_goal', 'personal_responsibility', 'architecture_design', 'key_implementation', 'technical_tradeoff', 'data_metrics', 'incident_debugging', 'collaboration_delivery', 'security_quality', 'reflection_evolution')),
  `guidance_slots_json` text NOT NULL DEFAULT '[]',
  `evidence_refs_json` text NOT NULL DEFAULT '[]',
  `question_task_id` text REFERENCES `tasks`(`id`) ON DELETE SET NULL,
  `question_agent_run_id` text REFERENCES `agent_runs`(`id`) ON DELETE RESTRICT,
  `digest_task_id` text REFERENCES `tasks`(`id`) ON DELETE SET NULL,
  `digest_agent_run_id` text REFERENCES `agent_runs`(`id`) ON DELETE RESTRICT,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  UNIQUE (`session_id`, `turn_no`)
);
--> statement-breakpoint
CREATE INDEX `drill_turns_session_status_idx` ON `drill_turns` (`session_id`, `status`, `turn_no` DESC);
--> statement-breakpoint
CREATE TABLE `drill_answer_revisions` (
  `id` text PRIMARY KEY NOT NULL,
  `turn_id` text NOT NULL REFERENCES `drill_turns`(`id`) ON DELETE CASCADE,
  `revision_no` integer NOT NULL CHECK (`revision_no` >= 1),
  `answer_text` text NOT NULL CHECK (length(trim(`answer_text`)) > 0),
  `content_hash` text NOT NULL CHECK (length(`content_hash`) = 64),
  `idempotency_key` text NOT NULL,
  `created_at` integer NOT NULL,
  UNIQUE (`turn_id`, `revision_no`),
  UNIQUE (`turn_id`, `idempotency_key`)
);
--> statement-breakpoint
CREATE TABLE `project_knowledge_items` (
  `id` text PRIMARY KEY NOT NULL,
  `dossier_id` text NOT NULL REFERENCES `project_dossiers`(`id`) ON DELETE CASCADE,
  `source_answer_revision_id` text NOT NULL REFERENCES `drill_answer_revisions`(`id`) ON DELETE CASCADE,
  `kind` text NOT NULL CHECK (`kind` IN ('fact', 'decision', 'metric', 'incident', 'lesson', 'ambiguity', 'conflict')),
  `statement` text NOT NULL,
  `quote` text NOT NULL,
  `source_start` integer NOT NULL CHECK (`source_start` >= 0),
  `source_end` integer NOT NULL CHECK (`source_end` > `source_start`),
  `status` text NOT NULL CHECK (`status` IN ('active', 'superseded')),
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `project_knowledge_items_dossier_status_idx` ON `project_knowledge_items` (`dossier_id`, `status`, `created_at`);
--> statement-breakpoint
CREATE TABLE `drill_coverage` (
  `session_id` text NOT NULL REFERENCES `drill_sessions`(`id`) ON DELETE CASCADE,
  `dimension` text NOT NULL CHECK (`dimension` IN ('background_goal', 'personal_responsibility', 'architecture_design', 'key_implementation', 'technical_tradeoff', 'data_metrics', 'incident_debugging', 'collaboration_delivery', 'security_quality', 'reflection_evolution')),
  `status` text NOT NULL CHECK (`status` IN ('unasked', 'asked', 'evidence_partial', 'evidence_sufficient', 'needs_clarification')),
  `evidence_item_ids_json` text NOT NULL DEFAULT '[]',
  `updated_at` integer NOT NULL,
  PRIMARY KEY (`session_id`, `dimension`)
);
