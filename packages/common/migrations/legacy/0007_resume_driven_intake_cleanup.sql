-- Canonicalize the existing projection, then remove jobs outside the current
-- default profile's R&D intake scope. Future syncs apply the same policy before
-- writing raw evidence, jobs, or revisions.
UPDATE jobs
SET job_family = CASE
      WHEN lower(coalesce(title, '') || ' ' || coalesce(department, '') || ' ' || coalesce(job_family, '')) LIKE '%研发%'
        OR lower(coalesce(title, '') || ' ' || coalesce(department, '') || ' ' || coalesce(job_family, '')) LIKE '%技术%'
        OR lower(coalesce(title, '') || ' ' || coalesce(department, '') || ' ' || coalesce(job_family, '')) LIKE '%算法%'
        OR lower(coalesce(title, '') || ' ' || coalesce(department, '') || ' ' || coalesce(job_family, '')) LIKE '%开发%'
        OR lower(coalesce(title, '') || ' ' || coalesce(department, '') || ' ' || coalesce(job_family, '')) LIKE '%工程师%'
        OR lower(coalesce(title, '') || ' ' || coalesce(department, '') || ' ' || coalesce(job_family, '')) LIKE '%人工智能%'
        OR lower(coalesce(title, '') || ' ' || coalesce(department, '') || ' ' || coalesce(job_family, '')) LIKE '%大模型%'
        OR lower(coalesce(title, '') || ' ' || coalesce(department, '') || ' ' || coalesce(job_family, '')) LIKE '%机器学习%'
        OR lower(coalesce(title, '') || ' ' || coalesce(department, '') || ' ' || coalesce(job_family, '')) LIKE '%后端%'
        OR lower(coalesce(title, '') || ' ' || coalesce(department, '') || ' ' || coalesce(job_family, '')) LIKE '%前端%'
        OR lower(coalesce(title, '') || ' ' || coalesce(department, '') || ' ' || coalesce(job_family, '')) LIKE '%客户端%'
        OR lower(coalesce(title, '') || ' ' || coalesce(department, '') || ' ' || coalesce(job_family, '')) LIKE '%引擎%'
        OR lower(coalesce(title, '') || ' ' || coalesce(department, '') || ' ' || coalesce(job_family, '')) LIKE '%软件%'
      THEN '研发'
      WHEN lower(coalesce(title, '') || ' ' || coalesce(department, '') || ' ' || coalesce(job_family, '')) LIKE '%产品%' THEN '产品'
      WHEN lower(coalesce(title, '') || ' ' || coalesce(department, '') || ' ' || coalesce(job_family, '')) LIKE '%设计%' THEN '设计'
      WHEN lower(coalesce(title, '') || ' ' || coalesce(department, '') || ' ' || coalesce(job_family, '')) LIKE '%运营%' THEN '运营'
      WHEN lower(coalesce(title, '') || ' ' || coalesce(department, '') || ' ' || coalesce(job_family, '')) LIKE '%销售%'
        OR lower(coalesce(title, '') || ' ' || coalesce(department, '') || ' ' || coalesce(job_family, '')) LIKE '%客服%' THEN '销售'
      WHEN lower(coalesce(title, '') || ' ' || coalesce(department, '') || ' ' || coalesce(job_family, '')) LIKE '%数据%' THEN '数据'
      WHEN lower(coalesce(title, '') || ' ' || coalesce(department, '') || ' ' || coalesce(job_family, '')) LIKE '%测试%'
        OR lower(coalesce(title, '') || ' ' || coalesce(department, '') || ' ' || coalesce(job_family, '')) LIKE '%质量%' THEN '测试'
      WHEN lower(coalesce(title, '') || ' ' || coalesce(department, '') || ' ' || coalesce(job_family, '')) LIKE '%市场%'
        OR lower(coalesce(title, '') || ' ' || coalesce(department, '') || ' ' || coalesce(job_family, '')) LIKE '%营销%' THEN '市场'
      WHEN lower(coalesce(title, '') || ' ' || coalesce(department, '') || ' ' || coalesce(job_family, '')) LIKE '%人力%'
        OR lower(coalesce(title, '') || ' ' || coalesce(department, '') || ' ' || coalesce(job_family, '')) LIKE '%财务%'
        OR lower(coalesce(title, '') || ' ' || coalesce(department, '') || ' ' || coalesce(job_family, '')) LIKE '%法务%'
        OR lower(coalesce(title, '') || ' ' || coalesce(department, '') || ' ' || coalesce(job_family, '')) LIKE '%行政%' THEN '职能'
      ELSE '其他'
    END,
    job_subfamily = CASE
      WHEN lower(coalesce(title, '') || ' ' || coalesce(department, '') || ' ' || coalesce(job_family, '')) LIKE '%后端%'
        OR lower(coalesce(title, '') || ' ' || coalesce(department, '') || ' ' || coalesce(job_family, '')) LIKE '%服务端%' THEN '后端'
      WHEN lower(coalesce(title, '') || ' ' || coalesce(department, '') || ' ' || coalesce(job_family, '')) LIKE '%前端%' THEN '前端'
      WHEN lower(coalesce(title, '') || ' ' || coalesce(department, '') || ' ' || coalesce(job_family, '')) LIKE '%算法%'
        OR lower(coalesce(title, '') || ' ' || coalesce(department, '') || ' ' || coalesce(job_family, '')) LIKE '%大模型%'
        OR lower(coalesce(title, '') || ' ' || coalesce(department, '') || ' ' || coalesce(job_family, '')) LIKE '%人工智能%'
        OR lower(coalesce(title, '') || ' ' || coalesce(department, '') || ' ' || coalesce(job_family, '')) LIKE '%机器学习%' THEN '算法'
      WHEN lower(coalesce(title, '') || ' ' || coalesce(department, '') || ' ' || coalesce(job_family, '')) LIKE '%客户端%'
        OR lower(coalesce(title, '') || ' ' || coalesce(department, '') || ' ' || coalesce(job_family, '')) LIKE '%移动端%' THEN '客户端'
      WHEN lower(coalesce(title, '') || ' ' || coalesce(department, '') || ' ' || coalesce(job_family, '')) LIKE '%测试%'
        OR lower(coalesce(title, '') || ' ' || coalesce(department, '') || ' ' || coalesce(job_family, '')) LIKE '%质量%' THEN '测试'
      WHEN lower(coalesce(title, '') || ' ' || coalesce(department, '') || ' ' || coalesce(job_family, '')) LIKE '%数据分析%'
        OR lower(coalesce(title, '') || ' ' || coalesce(department, '') || ' ' || coalesce(job_family, '')) LIKE '%商业分析%' THEN '数据分析'
      WHEN lower(coalesce(title, '') || ' ' || coalesce(department, '') || ' ' || coalesce(job_family, '')) LIKE '%产品经理%' THEN '产品经理'
      WHEN lower(coalesce(title, '') || ' ' || coalesce(department, '') || ' ' || coalesce(job_family, '')) LIKE '%交互%' THEN '交互设计'
      WHEN lower(coalesce(title, '') || ' ' || coalesce(department, '') || ' ' || coalesce(job_family, '')) LIKE '%视觉%' THEN '视觉设计'
      ELSE NULL
    END;
--> statement-breakpoint
CREATE TEMP TABLE intake_cleanup_jobs AS
SELECT id, source_id, external_job_id
FROM jobs
WHERE job_family <> '研发';
--> statement-breakpoint
CREATE TEMP TABLE intake_cleanup_revisions AS
SELECT id
FROM job_revisions
WHERE job_id IN (SELECT id FROM intake_cleanup_jobs);
--> statement-breakpoint
CREATE TEMP TABLE intake_cleanup_matches AS
SELECT id
FROM match_results
WHERE job_revision_id IN (SELECT id FROM intake_cleanup_revisions);
--> statement-breakpoint
CREATE TEMP TABLE intake_cleanup_agents AS
SELECT agent_run_id AS id
FROM job_enrichments
WHERE job_revision_id IN (SELECT id FROM intake_cleanup_revisions)
UNION
SELECT agent_run_id AS id
FROM match_advices
WHERE match_result_id IN (SELECT id FROM intake_cleanup_matches);
--> statement-breakpoint
CREATE TEMP TABLE intake_cleanup_raw AS
SELECT DISTINCT raw.id, raw.artifact_id
FROM raw_job_records raw
WHERE raw.id IN (
  SELECT revision.raw_record_id
  FROM job_revisions revision
  WHERE revision.id IN (SELECT id FROM intake_cleanup_revisions)
)
OR EXISTS (
  SELECT 1
  FROM intake_cleanup_jobs job
  WHERE job.source_id = raw.source_id AND job.external_job_id = raw.external_job_id
);
--> statement-breakpoint
DELETE FROM match_advices
WHERE match_result_id IN (SELECT id FROM intake_cleanup_matches);
--> statement-breakpoint
DELETE FROM match_results
WHERE id IN (SELECT id FROM intake_cleanup_matches);
--> statement-breakpoint
DELETE FROM agent_tool_calls
WHERE agent_run_id IN (SELECT id FROM intake_cleanup_agents);
--> statement-breakpoint
DELETE FROM job_enrichments
WHERE job_revision_id IN (SELECT id FROM intake_cleanup_revisions);
--> statement-breakpoint
DELETE FROM agent_runs
WHERE id IN (SELECT id FROM intake_cleanup_agents)
  AND NOT EXISTS (SELECT 1 FROM profile_versions WHERE agent_run_id = agent_runs.id)
  AND NOT EXISTS (SELECT 1 FROM job_enrichments WHERE agent_run_id = agent_runs.id)
  AND NOT EXISTS (SELECT 1 FROM match_advices WHERE agent_run_id = agent_runs.id);
--> statement-breakpoint
DELETE FROM job_observations
WHERE job_id IN (SELECT id FROM intake_cleanup_jobs);
--> statement-breakpoint
DELETE FROM sync_seen_jobs
WHERE job_id IN (SELECT id FROM intake_cleanup_jobs);
--> statement-breakpoint
DELETE FROM job_status_events
WHERE job_id IN (SELECT id FROM intake_cleanup_jobs);
--> statement-breakpoint
DELETE FROM job_revisions
WHERE id IN (SELECT id FROM intake_cleanup_revisions);
--> statement-breakpoint
DELETE FROM jobs
WHERE id IN (SELECT id FROM intake_cleanup_jobs);
--> statement-breakpoint
DELETE FROM raw_job_records
WHERE id IN (SELECT id FROM intake_cleanup_raw);
--> statement-breakpoint
DELETE FROM file_artifacts
WHERE id IN (SELECT artifact_id FROM intake_cleanup_raw WHERE artifact_id IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM raw_job_records WHERE artifact_id = file_artifacts.id)
  AND NOT EXISTS (SELECT 1 FROM resume_documents WHERE artifact_id = file_artifacts.id);
--> statement-breakpoint
UPDATE tasks
SET retry_of_task_id = NULL
WHERE retry_of_task_id IN (
  SELECT id FROM tasks
  WHERE task_type IN ('match.compute-profile', 'job.enrich', 'match.advise')
     OR (task_type = 'match.compute-revision' AND idempotency_key NOT LIKE 'match.compute-job:%')
);
--> statement-breakpoint
DELETE FROM tasks
WHERE task_type IN ('match.compute-profile', 'job.enrich', 'match.advise')
   OR (task_type = 'match.compute-revision' AND idempotency_key NOT LIKE 'match.compute-job:%');
--> statement-breakpoint
DROP TABLE intake_cleanup_raw;
--> statement-breakpoint
DROP TABLE intake_cleanup_agents;
--> statement-breakpoint
DROP TABLE intake_cleanup_matches;
--> statement-breakpoint
DROP TABLE intake_cleanup_revisions;
--> statement-breakpoint
DROP TABLE intake_cleanup_jobs;
