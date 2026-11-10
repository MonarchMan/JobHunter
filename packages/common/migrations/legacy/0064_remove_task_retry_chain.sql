-- 1、原地重试不再产生任务链，先移除引用旧字段的触发器和索引。
DROP TRIGGER tasks_diagnostic_projection_insert;
--> statement-breakpoint
DROP INDEX tasks_detail_batch_idx;
--> statement-breakpoint
ALTER TABLE tasks DROP COLUMN retry_of_task_id;
--> statement-breakpoint
ALTER TABLE tasks DROP COLUMN retry_root_task_id;
--> statement-breakpoint
-- 2、保留来源与扫描身份投影，不改写历史任务状态和执行结果。
CREATE TRIGGER tasks_diagnostic_projection_insert AFTER INSERT ON tasks BEGIN
 UPDATE tasks SET
 source_run_id = CASE WHEN json_type(NEW.private_state, '$.runId') = 'text' THEN json_extract(NEW.private_state, '$.runId') END,
 source_id = CASE
   WHEN json_type(NEW.private_state, '$.sourceId') = 'text' THEN json_extract(NEW.private_state, '$.sourceId')
   WHEN json_type(NEW.private_state, '$.sourceIds[0]') = 'text' THEN json_extract(NEW.private_state, '$.sourceIds[0]')
 END
 WHERE id = NEW.id;
END;
--> statement-breakpoint
CREATE INDEX tasks_detail_batch_idx ON tasks(source_run_id, source_id)
WHERE task_type = 'source.job-detail';
