-- 1、退休内容前清理派生结果及任务；观察记录只保留“见过”的事实，不再还原历史正文。
CREATE TRIGGER job_content_retire BEFORE DELETE ON job_revisions BEGIN
  UPDATE tasks SET status = 'cancelled',
    cancel_requested_at = COALESCE(cancel_requested_at, CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    finished_at = CAST(unixepoch('subsec') * 1000 AS INTEGER),
    lease_owner = NULL, lease_expires_at = NULL,
    error_category = 'cancelled', error_summary = '职位内容已更新，请针对当前内容重新评分。'
  WHERE status IN ('pending', 'running')
    AND task_type IN ('job.enrich', 'match.score-job', 'match.compute-revision', 'match.advise')
    AND (json_extract(payload_json, '$.jobRevisionId') = OLD.id
      OR json_extract(payload_json, '$.matchResultId') IN
        (SELECT id FROM match_results WHERE job_revision_id = OLD.id));
  DELETE FROM match_advices WHERE match_result_id IN
    (SELECT id FROM match_results WHERE job_revision_id = OLD.id);
  DELETE FROM match_results WHERE job_revision_id = OLD.id;
  DELETE FROM job_enrichments WHERE job_revision_id = OLD.id;
  UPDATE job_observations SET job_revision_id = (
    SELECT id FROM job_revisions WHERE job_id = OLD.job_id AND id != OLD.id
    ORDER BY revision_no DESC LIMIT 1
  ) WHERE job_revision_id = OLD.id AND EXISTS (
    SELECT 1 FROM job_revisions WHERE job_id = OLD.job_id AND id != OLD.id
  );
  DELETE FROM job_observations WHERE job_revision_id = OLD.id;
END;
--> statement-breakpoint
-- 2、存量只保留最新代际及对应结果；清空差异中的旧正文。
DELETE FROM job_revisions WHERE id NOT IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY job_id ORDER BY revision_no DESC) AS position
    FROM job_revisions
  ) WHERE position = 1
);
--> statement-breakpoint
UPDATE job_revisions SET change_set_json = '[]';
--> statement-breakpoint
-- 3、官网、详情与平台统一在插入语句结束前收敛为单份内容；外键拒绝旧代际结果回写。
CREATE TRIGGER job_content_replace AFTER INSERT ON job_revisions BEGIN
  DELETE FROM job_revisions WHERE job_id = NEW.job_id AND id != NEW.id;
  UPDATE job_revisions SET change_set_json = '[]' WHERE id = NEW.id;
END;
