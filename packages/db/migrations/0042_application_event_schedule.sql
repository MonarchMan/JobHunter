-- 1、日历高频字段提升为类型化列；payload_json 继续保留非查询型详情。
ALTER TABLE application_events ADD COLUMN activity_type TEXT
  CHECK (activity_type IS NULL OR activity_type IN ('interview', 'written_exam', 'assessment', 'coding_test'));
--> statement-breakpoint
ALTER TABLE application_events ADD COLUMN scheduled_start_at INTEGER;
--> statement-breakpoint
ALTER TABLE application_events ADD COLUMN scheduled_end_at INTEGER;
--> statement-breakpoint
ALTER TABLE application_events ADD COLUMN deadline_at INTEGER;
--> statement-breakpoint
ALTER TABLE application_events ADD COLUMN scheduled_start_local_date TEXT;
--> statement-breakpoint
ALTER TABLE application_events ADD COLUMN scheduled_end_local_date TEXT;
--> statement-breakpoint
ALTER TABLE application_events ADD COLUMN deadline_local_date TEXT;
--> statement-breakpoint
ALTER TABLE application_events ADD COLUMN previous_scheduled_start_at INTEGER;
--> statement-breakpoint
ALTER TABLE application_events ADD COLUMN previous_scheduled_start_local_date TEXT;
--> statement-breakpoint
ALTER TABLE application_events ADD COLUMN time_precision TEXT
  CHECK (time_precision IS NULL OR time_precision IN ('exact_time', 'date_only', 'time_range', 'date_range', 'unknown'));
--> statement-breakpoint
ALTER TABLE application_events ADD COLUMN timezone_source TEXT
  CHECK (timezone_source IS NULL OR timezone_source IN ('explicit', 'mailbox_default', 'not_applicable', 'unknown'));
--> statement-breakpoint
ALTER TABLE application_events ADD COLUMN timezone_text TEXT;
--> statement-breakpoint
ALTER TABLE application_events ADD COLUMN stage_label TEXT;
--> statement-breakpoint
ALTER TABLE application_events ADD COLUMN location TEXT;
--> statement-breakpoint
ALTER TABLE application_events ADD COLUMN meeting_url TEXT;
--> statement-breakpoint
ALTER TABLE application_events ADD COLUMN action_url TEXT;
--> statement-breakpoint
-- 2、只从当前统一 schedule 结构回填；旧分类格式不再兼容。
UPDATE application_events
SET
  activity_type = json_extract(payload_json, '$.schedule.activityType'),
  scheduled_start_at = json_extract(payload_json, '$.schedule.scheduledStartAt'),
  scheduled_end_at = json_extract(payload_json, '$.schedule.scheduledEndAt'),
  deadline_at = json_extract(payload_json, '$.schedule.deadlineAt'),
  scheduled_start_local_date = json_extract(payload_json, '$.schedule.scheduledStartLocalDate'),
  scheduled_end_local_date = json_extract(payload_json, '$.schedule.scheduledEndLocalDate'),
  deadline_local_date = json_extract(payload_json, '$.schedule.deadlineLocalDate'),
  previous_scheduled_start_at = json_extract(payload_json, '$.schedule.previousScheduledStartAt'),
  previous_scheduled_start_local_date = json_extract(payload_json, '$.schedule.previousScheduledStartLocalDate'),
  time_precision = json_extract(payload_json, '$.schedule.timePrecision'),
  timezone_source = json_extract(payload_json, '$.schedule.timezoneSource'),
  timezone_text = json_extract(payload_json, '$.schedule.timezoneText'),
  stage_label = json_extract(payload_json, '$.schedule.stageLabel'),
  location = json_extract(payload_json, '$.location'),
  meeting_url = json_extract(payload_json, '$.meetingUrl'),
  action_url = json_extract(payload_json, '$.actionUrl')
WHERE json_type(payload_json, '$.schedule') = 'object'
  AND event_type IN ('assessment_invited', 'interview_invited', 'interview_rescheduled', 'interview_cancelled');
--> statement-breakpoint
CREATE INDEX application_events_scheduled_start_idx ON application_events (scheduled_start_at);
--> statement-breakpoint
CREATE INDEX application_events_deadline_idx ON application_events (deadline_at);
--> statement-breakpoint
CREATE INDEX application_events_scheduled_local_date_idx ON application_events (scheduled_start_local_date);
--> statement-breakpoint
CREATE INDEX application_events_deadline_local_date_idx ON application_events (deadline_local_date);
