-- 1、日程类型是可由招聘邮件重新生成的投影，直接清空事件表而不兼容旧活动类型。
DROP TABLE application_events;
--> statement-breakpoint
-- 2、按当前三种活动类型重建事件事实表，彻底移除 coding_test。
CREATE TABLE application_events (
  id TEXT PRIMARY KEY NOT NULL,
  application_id TEXT NOT NULL REFERENCES job_applications(id) ON DELETE CASCADE,
  sequence_no INTEGER NOT NULL CHECK (sequence_no >= 1),
  mail_message_ref_id TEXT NOT NULL REFERENCES mail_message_refs(id) ON DELETE RESTRICT,
  source_content_hash TEXT NOT NULL,
  source_event_no INTEGER NOT NULL CHECK (source_event_no >= 1),
  acceptance_kind TEXT NOT NULL CHECK (acceptance_kind IN ('automatic', 'user_confirmed')),
  classifier_kind TEXT NOT NULL CHECK (classifier_kind IN ('rules', 'agent')),
  classifier_version TEXT NOT NULL,
  agent_run_id TEXT REFERENCES agent_runs(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL,
  effective_at INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  activity_type TEXT CHECK (
    activity_type IS NULL OR activity_type IN ('interview', 'written_exam', 'assessment')
  ),
  scheduled_start_at INTEGER,
  scheduled_end_at INTEGER,
  deadline_at INTEGER,
  scheduled_start_local_date TEXT,
  scheduled_end_local_date TEXT,
  deadline_local_date TEXT,
  previous_scheduled_start_at INTEGER,
  previous_scheduled_start_local_date TEXT,
  time_precision TEXT CHECK (
    time_precision IS NULL OR time_precision IN (
      'exact_time', 'date_only', 'time_range', 'date_range', 'unknown'
    )
  ),
  timezone_source TEXT CHECK (
    timezone_source IS NULL OR timezone_source IN (
      'explicit', 'mailbox_default', 'not_applicable', 'unknown'
    )
  ),
  timezone_text TEXT,
  stage_label TEXT,
  location TEXT,
  meeting_url TEXT,
  action_url TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  UNIQUE (application_id, sequence_no),
  UNIQUE (mail_message_ref_id, source_content_hash, source_event_no)
);
--> statement-breakpoint
-- 3、恢复事件回放和日历范围查询依赖的索引。
CREATE INDEX application_events_application_effective_idx
  ON application_events (application_id, effective_at);
--> statement-breakpoint
CREATE INDEX application_events_scheduled_start_idx
  ON application_events (scheduled_start_at);
--> statement-breakpoint
CREATE INDEX application_events_deadline_idx
  ON application_events (deadline_at);
--> statement-breakpoint
CREATE INDEX application_events_scheduled_local_date_idx
  ON application_events (scheduled_start_local_date);
--> statement-breakpoint
CREATE INDEX application_events_deadline_local_date_idx
  ON application_events (deadline_local_date);
