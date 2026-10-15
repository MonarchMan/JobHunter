-- 1、邮箱只保存最小消息引用，运行游标和加密凭据仍在文件系统。
CREATE TABLE mail_message_refs (
  id TEXT PRIMARY KEY NOT NULL,
  mailbox_key TEXT NOT NULL,
  provider_key TEXT NOT NULL CHECK (provider_key IN ('gmail', 'microsoft-graph', 'imap')),
  external_message_key TEXT NOT NULL,
  thread_key_hash TEXT,
  source_url TEXT,
  received_at INTEGER NOT NULL,
  content_version TEXT NOT NULL,
  content_hash TEXT,
  processing_status TEXT NOT NULL DEFAULT 'discovered' CHECK (processing_status IN ('discovered', 'candidate', 'accepted', 'needs_review', 'ignored', 'failed')),
  last_classifier_kind TEXT CHECK (last_classifier_kind IS NULL OR last_classifier_kind IN ('rules', 'agent')),
  last_classifier_version TEXT,
  last_seen_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (mailbox_key, external_message_key)
);
--> statement-breakpoint
CREATE INDEX mail_message_refs_status_received_idx ON mail_message_refs (processing_status, received_at);
--> statement-breakpoint
CREATE INDEX mail_message_refs_mailbox_received_idx ON mail_message_refs (mailbox_key, received_at);
--> statement-breakpoint
-- 2、申请当前态与专用事件时间线独立于职位来源事实。
CREATE TABLE job_applications (
  id TEXT PRIMARY KEY NOT NULL,
  company_id TEXT REFERENCES companies(id) ON DELETE RESTRICT,
  job_id TEXT REFERENCES jobs(id) ON DELETE RESTRICT,
  external_application_key_hash TEXT,
  company_name TEXT NOT NULL,
  role_title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unknown' CHECK (status IN ('unknown', 'applied', 'assessment', 'interview', 'offer_intent', 'offered', 'rejected', 'closed')),
  status_effective_at INTEGER,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX job_applications_status_updated_idx ON job_applications (status, updated_at DESC);
--> statement-breakpoint
CREATE INDEX job_applications_company_role_idx ON job_applications (company_id, role_title);
--> statement-breakpoint
CREATE INDEX job_applications_job_idx ON job_applications (job_id);
--> statement-breakpoint
CREATE INDEX job_applications_external_key_idx ON job_applications (external_application_key_hash);
--> statement-breakpoint
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
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  UNIQUE (application_id, sequence_no),
  UNIQUE (mail_message_ref_id, source_content_hash, source_event_no)
);
--> statement-breakpoint
CREATE INDEX application_events_application_effective_idx ON application_events (application_id, effective_at);
