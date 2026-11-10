-- 重试预算由系统按任务类型配置；保留累计次数和失败轮次日志。
ALTER TABLE tasks DROP COLUMN max_attempts;
