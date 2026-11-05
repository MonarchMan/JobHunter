-- 研究请求成为等待文件交付的父任务；历史进行中执行停止后可重新发布。
INSERT INTO tasks(id,task_type,private_state,public_state,status,idempotency_key,max_attempts,available_at,created_at,finished_at)
SELECT id,'interview.experience-research',json_object('research',json_object('brief_json', json(brief_json),'request_fingerprint', request_fingerprint,'prompt_hash', prompt_hash,'schema_version', schema_version,'prompt_file_id', prompt_file_id,'prompt_file_version_no', prompt_file_version_no,'schema_file_id', schema_file_id,'schema_file_version_no', schema_file_version_no,'bundle_file_id', bundle_file_id,'bundle_file_version_no', bundle_file_version_no,'current_task_id', current_task_id,'state', state,'revision', revision,'updated_at', updated_at,'bundle_import_token', NULL,'bundle_import_claimed_at', NULL,'bundle_import_file_id', NULL)),
json_object('phase',CASE WHEN bundle_file_id IS NULL THEN 'awaiting_result' ELSE 'imported' END),
CASE WHEN bundle_file_id IS NULL THEN 'pending' ELSE 'succeeded' END,
'research:'||request_fingerprint,1,253402300799000,created_at,CASE WHEN bundle_file_id IS NOT NULL THEN updated_at END
FROM experience_research_requests;
--> statement-breakpoint
UPDATE tasks SET parent_task_id=json_extract(private_state,'$.requestId')
WHERE task_type='interview.experience-research.execute' AND json_extract(private_state,'$.requestId') IN (SELECT id FROM experience_research_requests);
--> statement-breakpoint
UPDATE tasks SET status='cancelled', lease_owner=NULL,lease_expires_at=NULL, finished_at=coalesce(finished_at,created_at),error_category='cancelled',error_summary='Research delivery upgraded; publish again.' WHERE task_type='interview.experience-research.execute' AND status IN ('pending','running');
--> statement-breakpoint
CREATE TABLE interview_experiences_next (
  `id` text PRIMARY KEY NOT NULL,
  `file_id` text NOT NULL REFERENCES `files`(`id`) ON DELETE CASCADE,
  `sequence_no` integer NOT NULL CHECK (`sequence_no` >= 1),
  `source_type` text NOT NULL DEFAULT 'personal' CHECK (`source_type` IN ('personal', 'community')),
  `review_status` text NOT NULL DEFAULT 'draft'
    CHECK (`review_status` IN ('draft', 'needs_review', 'accepted', 'rejected')),
  `research_task_id` text REFERENCES tasks(id) ON DELETE SET NULL,
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
    (`source_type` = 'personal' AND `research_task_id` IS NULL
      AND `verification_status` = 'not_applicable')
    OR (`source_type` = 'community'
      AND `source_url` IS NOT NULL AND `source_title` IS NOT NULL
      AND `source_retrieved_at` IS NOT NULL AND `verification_status` <> 'not_applicable')
  )
);
--> statement-breakpoint
INSERT INTO interview_experiences_next SELECT * FROM interview_experiences;
--> statement-breakpoint
DROP TABLE interview_experiences;
--> statement-breakpoint
ALTER TABLE interview_experiences_next RENAME TO interview_experiences;
--> statement-breakpoint
DROP TABLE experience_research_requests;
--> statement-breakpoint
CREATE INDEX interview_experiences_company_role_idx ON interview_experiences(company,role,occurred_on DESC);
--> statement-breakpoint
CREATE INDEX interview_experiences_research_review_idx ON interview_experiences(research_task_id,review_status,sequence_no);
--> statement-breakpoint
CREATE TRIGGER research_task_cancelled AFTER UPDATE OF status ON tasks WHEN NEW.task_type='interview.experience-research' AND NEW.status='cancelled'
BEGIN
 UPDATE tasks SET cancel_requested_at=COALESCE(NEW.cancel_requested_at,NEW.finished_at,NEW.created_at),
 status=CASE WHEN status='pending' THEN 'cancelled' ELSE status END
 WHERE parent_task_id=NEW.id AND status IN ('pending','running');
END;
