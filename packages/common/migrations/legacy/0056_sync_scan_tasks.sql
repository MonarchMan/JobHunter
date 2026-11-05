ALTER TABLE tasks ADD COLUMN parent_task_id TEXT REFERENCES tasks(id) ON DELETE RESTRICT;
--> statement-breakpoint
INSERT INTO tasks(id,task_type,private_state,public_state,status,idempotency_key,
 attempt_count,max_attempts,available_at,created_at,started_at,finished_at,error_category,error_summary,parent_task_id)
SELECT r.id,'source.scan',json_object('sourceId',r.source_id,'trigger',r.trigger,'cursorOut',json(r.cursor_out_json)),
 json_object('status',CASE WHEN r.status='running' THEN 'cancelled' ELSE r.status END,
 'coverage',r.coverage,'stats',json(r.stats_json),'coverageEvidence',json(r.coverage_evidence_json)),
 CASE WHEN r.status='partial' THEN 'succeeded' WHEN r.status='running' THEN 'cancelled' ELSE r.status END,
 'source.scan:'||r.id,1,1,r.started_at,r.started_at,r.started_at,
 CASE WHEN r.status='running' THEN COALESCE(r.finished_at,r.started_at) ELSE r.finished_at END,
 CASE WHEN r.status='running' THEN 'cancelled' ELSE r.error_category END,
 CASE WHEN r.status='running' THEN 'Synchronization interrupted before database upgrade.' ELSE r.error_summary END,
 (SELECT t.id FROM tasks t WHERE t.task_type='source.sync' AND
  (json_extract(t.public_state,'$.runId')=r.id OR EXISTS
   (SELECT 1 FROM json_each(t.public_state,'$.runs') v WHERE json_extract(v.value,'$.runId')=r.id))
  ORDER BY t.created_at DESC LIMIT 1)
FROM sync_runs r;
--> statement-breakpoint
CREATE TABLE sync_seen_jobs_next (
 sync_run_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
 job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
 PRIMARY KEY(sync_run_id,job_id)
);
--> statement-breakpoint
INSERT INTO sync_seen_jobs_next SELECT * FROM sync_seen_jobs;
--> statement-breakpoint
DROP TABLE sync_seen_jobs;
--> statement-breakpoint
ALTER TABLE sync_seen_jobs_next RENAME TO sync_seen_jobs;
--> statement-breakpoint
CREATE TABLE job_observations_next (
 job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
 sync_run_id TEXT REFERENCES tasks(id) ON DELETE RESTRICT,
 observed_at INTEGER NOT NULL,
 platform_task_id TEXT REFERENCES tasks(id) ON DELETE RESTRICT,
 CHECK ((sync_run_id IS NOT NULL AND platform_task_id IS NULL) OR (sync_run_id IS NULL AND platform_task_id IS NOT NULL)),
 UNIQUE(job_id,sync_run_id), UNIQUE(job_id,platform_task_id)
);
--> statement-breakpoint
INSERT INTO job_observations_next SELECT * FROM job_observations;
--> statement-breakpoint
DROP TABLE job_observations;
--> statement-breakpoint
ALTER TABLE job_observations_next RENAME TO job_observations;
--> statement-breakpoint
CREATE INDEX job_observations_observed_idx ON job_observations(observed_at);
--> statement-breakpoint
DROP TABLE sync_runs;
--> statement-breakpoint
CREATE INDEX tasks_parent_idx ON tasks(parent_task_id);
--> statement-breakpoint
CREATE INDEX tasks_scan_source_started_idx ON tasks(source_id,started_at DESC) WHERE task_type='source.scan';
--> statement-breakpoint
CREATE UNIQUE INDEX tasks_scan_running_source_idx ON tasks(source_id) WHERE task_type='source.scan' AND status='running';
--> statement-breakpoint
CREATE TRIGGER tasks_scan_official_source BEFORE INSERT ON tasks
WHEN NEW.task_type='source.scan' AND NOT EXISTS
 (SELECT 1 FROM job_sources WHERE id=json_extract(NEW.private_state,'$.sourceId') AND source_kind='official')
BEGIN SELECT RAISE(ABORT, 'scan tasks require an official source'); END;
--> statement-breakpoint
CREATE TRIGGER tasks_close_unfinished_stages AFTER UPDATE OF status,lease_owner ON tasks
WHEN OLD.status='running' AND (NEW.status!='running' OR NEW.lease_owner IS NOT OLD.lease_owner)
BEGIN
 UPDATE tasks SET status='cancelled',finished_at=COALESCE(NEW.finished_at,NEW.available_at),
 error_category='cancelled',error_summary='Parent task execution ended before this stage completed.'
 WHERE parent_task_id=NEW.id AND status='running' AND lease_expires_at IS NULL;
END;
