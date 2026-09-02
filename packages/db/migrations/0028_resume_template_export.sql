CREATE TABLE `resume_template_drafts` (
  `id` text PRIMARY KEY NOT NULL,
  `profile_id` text NOT NULL REFERENCES `candidate_profiles`(`id`) ON DELETE CASCADE,
  `template_key` text NOT NULL,
  `template_version` integer NOT NULL CHECK (`template_version` >= 1),
  `source_profile_version_id` text NOT NULL,
  `content_json` text NOT NULL,
  `avatar_file_id` text REFERENCES `files`(`id`) ON DELETE RESTRICT,
  `avatar_file_version` integer CHECK (`avatar_file_version` BETWEEN 1 AND 5),
  `revision` integer NOT NULL DEFAULT 0 CHECK (`revision` >= 0),
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  UNIQUE (`profile_id`, `template_key`, `template_version`),
  CHECK ((`avatar_file_id` IS NULL) = (`avatar_file_version` IS NULL))
);
--> statement-breakpoint
CREATE INDEX `resume_template_drafts_profile_idx`
  ON `resume_template_drafts` (`profile_id`, `updated_at` DESC);
--> statement-breakpoint
CREATE TABLE `resume_export_requests` (
  `id` text PRIMARY KEY NOT NULL,
  `draft_id` text NOT NULL REFERENCES `resume_template_drafts`(`id`) ON DELETE CASCADE,
  `format` text NOT NULL CHECK (`format` IN ('pdf', 'html')),
  `draft_revision` integer NOT NULL CHECK (`draft_revision` >= 0),
  `input_file_id` text NOT NULL REFERENCES `files`(`id`) ON DELETE RESTRICT,
  `input_file_version` integer NOT NULL CHECK (`input_file_version` BETWEEN 1 AND 5),
  `output_file_id` text REFERENCES `files`(`id`) ON DELETE RESTRICT,
  `output_file_version` integer CHECK (`output_file_version` BETWEEN 1 AND 5),
  `task_id` text REFERENCES `tasks`(`id`) ON DELETE SET NULL,
  `status` text NOT NULL CHECK (`status` IN ('pending', 'succeeded', 'failed', 'delivered')),
  `file_name` text NOT NULL,
  `error_summary` text,
  `expires_at` integer NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  CHECK ((`output_file_id` IS NULL) = (`output_file_version` IS NULL))
);
--> statement-breakpoint
CREATE INDEX `resume_export_requests_expiry_idx`
  ON `resume_export_requests` (`status`, `expires_at`);
