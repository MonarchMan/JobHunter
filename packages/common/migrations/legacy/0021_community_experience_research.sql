CREATE TABLE `experience_research_requests` (
  `id` text PRIMARY KEY NOT NULL,
  `brief_json` text NOT NULL CHECK (json_valid(`brief_json`)),
  `request_fingerprint` text NOT NULL UNIQUE CHECK (length(`request_fingerprint`) = 64),
  `prompt_version` text NOT NULL,
  `schema_version` text NOT NULL,
  `prompt_file_id` text NOT NULL REFERENCES `files`(`id`) ON DELETE RESTRICT,
  `prompt_file_version_no` integer NOT NULL CHECK (`prompt_file_version_no` BETWEEN 1 AND 5),
  `schema_file_id` text NOT NULL REFERENCES `files`(`id`) ON DELETE RESTRICT,
  `schema_file_version_no` integer NOT NULL CHECK (`schema_file_version_no` BETWEEN 1 AND 5),
  `bundle_file_id` text REFERENCES `files`(`id`) ON DELETE RESTRICT,
  `bundle_file_version_no` integer CHECK (`bundle_file_version_no` BETWEEN 1 AND 5),
  `current_task_id` text REFERENCES `tasks`(`id`) ON DELETE SET NULL,
  `state` text NOT NULL CHECK (`state` IN ('ready', 'needs_review', 'completed')),
  `revision` integer NOT NULL DEFAULT 0 CHECK (`revision` >= 0),
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  CHECK ((`bundle_file_id` IS NULL) = (`bundle_file_version_no` IS NULL))
);
--> statement-breakpoint
CREATE INDEX `experience_research_requests_state_updated_idx`
  ON `experience_research_requests` (`state`, `updated_at` DESC);
--> statement-breakpoint
CREATE TABLE `interview_experiences_new` (
  `id` text PRIMARY KEY NOT NULL,
  `file_id` text NOT NULL REFERENCES `files`(`id`) ON DELETE CASCADE,
  `sequence_no` integer NOT NULL CHECK (`sequence_no` >= 1),
  `source_type` text NOT NULL DEFAULT 'personal' CHECK (`source_type` IN ('personal', 'community')),
  `review_status` text NOT NULL DEFAULT 'draft'
    CHECK (`review_status` IN ('draft', 'needs_review', 'accepted', 'rejected')),
  `research_request_id` text REFERENCES `experience_research_requests`(`id`) ON DELETE CASCADE,
  `company` text,
  `role` text,
  `stage` text,
  `occurred_on` text CHECK (`occurred_on` IS NULL OR `occurred_on` GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  `outcome` text,
  `difficulty` text,
  `tags_json` text NOT NULL DEFAULT '[]',
  `notes` text,
  `source_url` text,
  `source_title` text,
  `source_published_at` text,
  `source_retrieved_at` text,
  `verification_status` text NOT NULL DEFAULT 'not_applicable'
    CHECK (`verification_status` IN ('not_applicable', 'unverified', 'verified')),
  UNIQUE (`file_id`, `sequence_no`),
  CHECK (
    (`source_type` = 'personal' AND `research_request_id` IS NULL
      AND `verification_status` = 'not_applicable')
    OR (`source_type` = 'community' AND `research_request_id` IS NOT NULL
      AND `source_url` IS NOT NULL AND `source_title` IS NOT NULL
      AND `source_retrieved_at` IS NOT NULL AND `verification_status` <> 'not_applicable')
  )
);
--> statement-breakpoint
INSERT INTO `interview_experiences_new`
  (`id`, `file_id`, `sequence_no`, `source_type`, `review_status`, `research_request_id`,
   `company`, `role`, `stage`, `occurred_on`, `outcome`, `difficulty`, `tags_json`, `notes`,
   `source_url`, `source_title`, `source_published_at`, `source_retrieved_at`,
   `verification_status`)
SELECT e.`id`, e.`file_id`, e.`sequence_no`, 'personal',
       CASE WHEN f.`state` = 'accepted' THEN 'accepted' ELSE 'draft' END,
       NULL, e.`company`, e.`role`, e.`stage`, e.`occurred_on`, e.`outcome`, e.`difficulty`,
       e.`tags_json`, e.`notes`, NULL, NULL, NULL, NULL, 'not_applicable'
FROM `interview_experiences` e
JOIN `files` f ON f.`id` = e.`file_id`;
--> statement-breakpoint
CREATE TABLE `interview_question_entries_new` (
  `id` text PRIMARY KEY NOT NULL,
  `experience_id` text NOT NULL REFERENCES `interview_experiences_new`(`id`) ON DELETE CASCADE,
  `sequence_no` integer NOT NULL CHECK (`sequence_no` >= 1),
  `question` text NOT NULL CHECK (length(trim(`question`)) > 0),
  `answer` text,
  `reflection` text,
  `answer_excerpt` text,
  `topics_json` text NOT NULL DEFAULT '[]',
  `evidence_excerpt` text,
  `question_fingerprint` text,
  `question_source_start` integer,
  `question_source_end` integer,
  `answer_source_start` integer,
  `answer_source_end` integer,
  UNIQUE (`experience_id`, `sequence_no`),
  CHECK (`question_fingerprint` IS NULL OR length(`question_fingerprint`) = 64),
  CHECK ((`question_source_start` IS NULL AND `question_source_end` IS NULL) OR (`question_source_start` >= 0 AND `question_source_end` > `question_source_start`)),
  CHECK ((`answer_source_start` IS NULL AND `answer_source_end` IS NULL) OR (`answer_source_start` >= 0 AND `answer_source_end` > `answer_source_start`))
);
--> statement-breakpoint
INSERT INTO `interview_question_entries_new`
  (`id`, `experience_id`, `sequence_no`, `question`, `answer`, `reflection`, `answer_excerpt`,
   `topics_json`, `evidence_excerpt`, `question_fingerprint`, `question_source_start`,
   `question_source_end`, `answer_source_start`, `answer_source_end`)
SELECT `id`, `experience_id`, `sequence_no`, `question`, `answer`, `reflection`, NULL, '[]', NULL,
       NULL, `question_source_start`, `question_source_end`, `answer_source_start`,
       `answer_source_end`
FROM `interview_question_entries`;
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
CREATE INDEX `interview_experiences_research_review_idx`
  ON `interview_experiences` (`research_request_id`, `review_status`, `sequence_no`);
--> statement-breakpoint
CREATE INDEX `interview_question_entries_experience_idx`
  ON `interview_question_entries` (`experience_id`, `sequence_no`);
--> statement-breakpoint
CREATE INDEX `interview_question_entries_fingerprint_idx`
  ON `interview_question_entries` (`question_fingerprint`, `experience_id`);
