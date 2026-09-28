CREATE TABLE task_retry_logs (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  retry_token TEXT NOT NULL,
  error_category TEXT,
  error_summary TEXT,
  attempt_count INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  retried_at INTEGER NOT NULL,
  PRIMARY KEY (task_id, retry_token)
);
