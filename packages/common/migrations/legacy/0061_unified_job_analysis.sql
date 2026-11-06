-- 旧独立模型任务不再分派；保留历史诊断，可由用户重新发起统一评分。
UPDATE tasks SET status='cancelled',finished_at=COALESCE(finished_at,created_at),lease_owner=NULL,lease_expires_at=NULL,error_category='cancelled',error_summary='职位分析已合并，请重新发起评分。' WHERE task_type IN ('job.enrich','match.advise') AND status IN ('pending','running');
--> statement-breakpoint
-- 旧建议阶段检查点不再跳过统一分析。
UPDATE tasks SET private_state=json_remove(private_state,'$.resumeMatchResultId') WHERE task_type='match.score-job' AND status IN ('pending','failed') AND json_type(private_state,'$.resumeMatchResultId') IS NOT NULL;
