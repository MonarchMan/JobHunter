-- 执行输入与可公开的检查点、结果分别归入私有和公开状态，保留原 JSON 内容。
ALTER TABLE tasks RENAME COLUMN payload_json TO private_state;
--> statement-breakpoint
ALTER TABLE tasks RENAME COLUMN result_json TO public_state;
--> statement-breakpoint
-- 重试可更换执行输入；关联索引必须跟随新输入，不能继续指向旧扫描。
CREATE TRIGGER tasks_diagnostic_projection_update AFTER UPDATE OF private_state ON tasks BEGIN
  UPDATE tasks SET
    source_run_id = CASE WHEN json_type(NEW.private_state, '$.runId') = 'text'
      THEN json_extract(NEW.private_state, '$.runId') END,
    source_id = CASE WHEN json_type(NEW.private_state, '$.sourceId') = 'text'
      THEN json_extract(NEW.private_state, '$.sourceId') END
  WHERE id = NEW.id;
END;
