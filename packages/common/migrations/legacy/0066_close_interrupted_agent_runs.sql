-- Agent 已结束时，其尚未完成的请求一并收尾，保留已经记录的 HTTP 状态和用量。
CREATE TRIGGER agent_close_unfinished_model_requests AFTER UPDATE OF status ON agent_runs
WHEN OLD.status = 'running' AND NEW.status IN ('failed', 'cancelled')
BEGIN
  UPDATE model_requests SET state = 'completed', transport_error = COALESCE(transport_error, 'cancelled')
  WHERE agent_run_id = NEW.id AND state = 'running';
END;
--> statement-breakpoint
-- 执行权结束即关闭遗留运行，覆盖重新排队、最后一次尝试失败和取消。
CREATE TRIGGER task_close_unfinished_agent_runs AFTER UPDATE OF status, lease_owner ON tasks
WHEN OLD.status = 'running' AND (NEW.status != 'running' OR NEW.lease_owner IS NOT OLD.lease_owner)
BEGIN
  UPDATE agent_runs SET
    status = CASE WHEN NEW.status = 'cancelled' THEN 'cancelled' ELSE 'failed' END,
    error_category = CASE WHEN NEW.status = 'cancelled' THEN 'cancelled' ELSE 'temporary' END,
    error_summary = '任务执行已结束，Agent 调用中断。',
    finished_at = MAX(started_at, COALESCE(NEW.finished_at, OLD.last_heartbeat_at, OLD.started_at, started_at))
  WHERE task_id = NEW.id AND status = 'running';
END;
--> statement-breakpoint
-- 历史遗留记录没有活跃的任务执行权，迁移时直接关闭。
UPDATE agent_runs SET
  status = CASE WHEN (SELECT status FROM tasks WHERE id = task_id) = 'cancelled' THEN 'cancelled' ELSE 'failed' END,
  error_category = CASE WHEN (SELECT status FROM tasks WHERE id = task_id) = 'cancelled' THEN 'cancelled' ELSE 'temporary' END,
  error_summary = '任务执行已结束，Agent 调用中断。',
  finished_at = MAX(started_at, COALESCE((SELECT finished_at FROM tasks WHERE id = task_id), started_at))
WHERE status = 'running' AND task_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM tasks WHERE id = task_id AND status = 'running');
