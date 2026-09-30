-- 1、从已保存的当前内容代际恢复更新时间，不把本次迁移当作职位变更。
-- 只修正有修订证据的记录；发布时间、观察、状态和正文全部保持原样。
UPDATE jobs
SET updated_at = (
  SELECT revision.created_at FROM job_revisions revision
  WHERE revision.job_id = jobs.id ORDER BY revision.revision_no DESC LIMIT 1
)
WHERE EXISTS (
  SELECT 1 FROM job_revisions revision WHERE revision.job_id = jobs.id
)
AND updated_at <> (
  SELECT revision.created_at FROM job_revisions revision
  WHERE revision.job_id = jobs.id ORDER BY revision.revision_no DESC LIMIT 1
);
