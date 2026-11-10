-- 运行创建时原子保存任务步骤身份，历史记录保持空关联，不清理既有输出副本。
ALTER TABLE agent_runs ADD COLUMN task_id TEXT;
--> statement-breakpoint
ALTER TABLE agent_runs ADD COLUMN step_key TEXT;
--> statement-breakpoint
ALTER TABLE agent_runs ADD COLUMN resource_key TEXT;
--> statement-breakpoint
CREATE INDEX agent_runs_task_step_idx ON agent_runs(task_id,step_key,resource_key);
--> statement-breakpoint
CREATE TRIGGER agent_recovery_task_finished BEFORE UPDATE OF status ON tasks WHEN NEW.status IN ('succeeded','cancelled') BEGIN UPDATE agent_runs SET output_json=NULL WHERE task_id=NEW.id; END;
--> statement-breakpoint
CREATE TRIGGER agent_recovery_task_deleted BEFORE DELETE ON tasks BEGIN UPDATE agent_runs SET output_json=NULL WHERE task_id=OLD.id; END;
--> statement-breakpoint
UPDATE tasks SET max_attempts=1 WHERE task_type='ai.reply';
--> statement-breakpoint
UPDATE tasks SET status='failed',finished_at=COALESCE(finished_at,created_at),error_category='cancelled',error_summary='对话生成已中断，请重新生成。',lease_owner=NULL,lease_expires_at=NULL WHERE task_type='ai.reply' AND status='pending' AND attempt_count>0;
--> statement-breakpoint
CREATE TABLE resume_polish_suggestions(id TEXT PRIMARY KEY NOT NULL,profile_version_id TEXT NOT NULL REFERENCES profile_versions(id) ON DELETE CASCADE,result_json TEXT NOT NULL CHECK(json_valid(result_json)));
--> statement-breakpoint
-- 只将仍有业务身份的润色结果迁入业务表，不删除历史诊断副本。
INSERT INTO resume_polish_suggestions SELECT json_extract(t.private_state,'$.suggestionId'),json_extract(t.private_state,'$.sourceVersionId'),r.output_json FROM tasks t JOIN agent_runs r ON r.id=json_extract(t.public_state,'$.agentRunId') WHERE t.task_type='resume.polish' AND t.status='succeeded' AND r.output_json IS NOT NULL AND json_extract(t.private_state,'$.suggestionId') IS NOT NULL AND EXISTS(SELECT 1 FROM profile_versions WHERE id=json_extract(t.private_state,'$.sourceVersionId')) ON CONFLICT(id) DO NOTHING;
