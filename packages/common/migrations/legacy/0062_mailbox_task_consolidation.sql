-- 招聘邮件识别并入 mailbox.sync@v1 第二阶段；取消未完成的独立分类任务，引用由后续同步重放。
UPDATE tasks
SET status='cancelled',
    finished_at=COALESCE(finished_at,created_at),
    lease_owner=NULL,
    lease_expires_at=NULL,
    cancel_requested_at=COALESCE(cancel_requested_at,created_at),
    error_category='cancelled',
    error_summary='招聘邮件识别已并入邮箱同步任务，将由后续同步自动重放。'
WHERE task_type='mail.classify@v1' AND status IN ('pending','running');
