-- 1、聚合来源同步任务以 sourceIds 首项作为新任务投影，不重写既有任务行。
DROP TRIGGER IF EXISTS tasks_diagnostic_projection_insert;
--> statement-breakpoint
CREATE TRIGGER tasks_diagnostic_projection_insert AFTER INSERT ON tasks BEGIN
 UPDATE tasks SET
 source_run_id = CASE WHEN json_type(NEW.payload_json, '$.runId') = 'text' THEN json_extract(NEW.payload_json, '$.runId') END,
 source_id = CASE
   WHEN json_type(NEW.payload_json, '$.sourceId') = 'text' THEN json_extract(NEW.payload_json, '$.sourceId')
   WHEN json_type(NEW.payload_json, '$.sourceIds[0]') = 'text' THEN json_extract(NEW.payload_json, '$.sourceIds[0]')
 END,
 retry_root_task_id = COALESCE((SELECT retry_root_task_id FROM tasks WHERE id = NEW.retry_of_task_id), NEW.id)
 WHERE id = NEW.id;
END;
