CREATE TABLE `drill_sessions_new` (
  `id` text PRIMARY KEY NOT NULL,
  `dossier_id` text NOT NULL REFERENCES `project_dossiers`(`id`) ON DELETE CASCADE,
  `profile_key` text NOT NULL CHECK (`profile_key` IN ('resume-only', 'docs-grounded')),
  `profile_version` text NOT NULL CHECK (`profile_version` = 'v1'),
  `profile_definition_hash` text NOT NULL,
  `capability_summary_json` text NOT NULL,
  `material_bindings_json` text NOT NULL DEFAULT '[]'
    CHECK (json_valid(`material_bindings_json`) AND json_type(`material_bindings_json`) = 'array'),
  `status` text NOT NULL CHECK (`status` IN ('active', 'paused', 'completed')),
  `context_revision` integer NOT NULL DEFAULT 0 CHECK (`context_revision` >= 0),
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `completed_at` integer,
  CHECK (
    (`profile_key` = 'resume-only' AND json_array_length(`material_bindings_json`) = 0)
    OR (`profile_key` = 'docs-grounded' AND json_array_length(`material_bindings_json`) BETWEEN 1 AND 8)
  )
);
--> statement-breakpoint
INSERT INTO `drill_sessions_new`
  (`id`, `dossier_id`, `profile_key`, `profile_version`, `profile_definition_hash`,
   `capability_summary_json`, `material_bindings_json`, `status`, `context_revision`,
   `created_at`, `updated_at`, `completed_at`)
SELECT `id`, `dossier_id`, `profile_key`, `profile_version`, `profile_definition_hash`,
       `capability_summary_json`, '[]', `status`, `context_revision`, `created_at`, `updated_at`,
       `completed_at`
FROM `drill_sessions`;
--> statement-breakpoint
DROP TABLE `drill_sessions`;
--> statement-breakpoint
ALTER TABLE `drill_sessions_new` RENAME TO `drill_sessions`;
--> statement-breakpoint
CREATE UNIQUE INDEX `drill_sessions_one_open_per_dossier_idx`
  ON `drill_sessions` (`dossier_id`) WHERE `status` IN ('active', 'paused');
