CREATE TABLE `experience_documents` (
  `id` text PRIMARY KEY NOT NULL,
  `artifact_id` text NOT NULL REFERENCES `file_artifacts`(`id`) ON DELETE RESTRICT,
  `content_hash` text NOT NULL CHECK (length(`content_hash`) = 64),
  `file_name` text NOT NULL CHECK (length(trim(`file_name`)) > 0),
  `media_type` text NOT NULL CHECK (`media_type` IN ('text/plain', 'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')),
  `source_mode` text NOT NULL CHECK (`source_mode` IN ('upload', 'online')),
  `extracted_text` text NOT NULL CHECK (length(trim(`extracted_text`)) > 0),
  `normalized_text` text NOT NULL CHECK (length(trim(`normalized_text`)) > 0),
  `parser_version` text NOT NULL,
  `template_version` text,
  `status` text NOT NULL CHECK (`status` IN ('draft', 'accepted', 'rejected')),
  `warnings_json` text NOT NULL DEFAULT '[]',
  `revision` integer NOT NULL DEFAULT 0 CHECK (`revision` >= 0),
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `accepted_at` integer,
  UNIQUE (`content_hash`, `parser_version`)
);
--> statement-breakpoint
CREATE INDEX `experience_documents_status_updated_idx`
  ON `experience_documents` (`status`, `updated_at` DESC);
--> statement-breakpoint
CREATE TABLE `interview_experiences` (
  `id` text PRIMARY KEY NOT NULL,
  `document_id` text NOT NULL REFERENCES `experience_documents`(`id`) ON DELETE CASCADE,
  `sequence_no` integer NOT NULL CHECK (`sequence_no` >= 1),
  `company` text,
  `role` text,
  `stage` text,
  `occurred_on` text CHECK (`occurred_on` IS NULL OR `occurred_on` GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  `outcome` text,
  `difficulty` text,
  `tags_json` text NOT NULL DEFAULT '[]',
  `notes` text,
  UNIQUE (`document_id`, `sequence_no`)
);
--> statement-breakpoint
CREATE INDEX `interview_experiences_company_role_idx`
  ON `interview_experiences` (`company`, `role`, `occurred_on` DESC);
--> statement-breakpoint
CREATE TABLE `interview_question_entries` (
  `id` text PRIMARY KEY NOT NULL,
  `experience_id` text NOT NULL REFERENCES `interview_experiences`(`id`) ON DELETE CASCADE,
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
CREATE INDEX `interview_question_entries_experience_idx`
  ON `interview_question_entries` (`experience_id`, `sequence_no`);
