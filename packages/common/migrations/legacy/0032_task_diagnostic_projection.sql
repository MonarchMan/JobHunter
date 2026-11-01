-- 1、批次字段是任务不可变输入的读投影；历史重试链只在迁移时展开一次。
ALTER TABLE tasks ADD COLUMN source_run_id TEXT;
--> statement-breakpoint
ALTER TABLE tasks ADD COLUMN source_id TEXT;
--> statement-breakpoint
ALTER TABLE tasks ADD COLUMN retry_root_task_id TEXT;
--> statement-breakpoint
UPDATE tasks SET
 source_run_id = CASE WHEN json_type(payload_json, '$.runId') = 'text' THEN json_extract(payload_json, '$.runId') END,
 source_id = CASE WHEN json_type(payload_json, '$.sourceId') = 'text' THEN json_extract(payload_json, '$.sourceId') END;
--> statement-breakpoint
WITH RECURSIVE roots(id, root_id) AS (
 SELECT id, id FROM tasks WHERE retry_of_task_id IS NULL
 UNION ALL
 SELECT child.id, roots.root_id FROM tasks child JOIN roots ON child.retry_of_task_id = roots.id
)
UPDATE tasks SET retry_root_task_id = COALESCE((SELECT root_id FROM roots WHERE roots.id = tasks.id), id);
--> statement-breakpoint
-- 2、统一覆盖仓储和直接 SQL 入队；父任务已存在，重试根可以常数时间继承。
CREATE TRIGGER tasks_diagnostic_projection_insert AFTER INSERT ON tasks BEGIN
 UPDATE tasks SET
 source_run_id = CASE WHEN json_type(NEW.payload_json, '$.runId') = 'text' THEN json_extract(NEW.payload_json, '$.runId') END,
 source_id = CASE WHEN json_type(NEW.payload_json, '$.sourceId') = 'text' THEN json_extract(NEW.payload_json, '$.sourceId') END,
 retry_root_task_id = COALESCE((SELECT retry_root_task_id FROM tasks WHERE id = NEW.retry_of_task_id), NEW.id)
 WHERE id = NEW.id;
END;
--> statement-breakpoint
CREATE INDEX tasks_detail_batch_idx ON tasks(source_run_id, source_id, retry_root_task_id, created_at DESC, id DESC)
WHERE task_type = 'source.job-detail';
