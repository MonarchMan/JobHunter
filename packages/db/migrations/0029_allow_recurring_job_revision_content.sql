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
  UNIQUE (`job_id`, `revision_no`)
);
--> statement-breakpoint
INSERT INTO `job_revisions_new`
  (`id`, `job_id`, `revision_no`, `content_hash`, `normalizer_version`,
   `source_payload_hash`, `source_url`, `snapshot_json`, `change_set_json`, `created_at`)
SELECT `id`, `job_id`, `revision_no`, `content_hash`, `normalizer_version`,
       `source_payload_hash`, `source_url`, `snapshot_json`, `change_set_json`, `created_at`
FROM `job_revisions`;
--> statement-breakpoint
DROP TABLE `job_revisions`;
--> statement-breakpoint
ALTER TABLE `job_revisions_new` RENAME TO `job_revisions`;
