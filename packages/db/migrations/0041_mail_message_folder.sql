-- 邮件正文按需读取必须使用显式文件夹身份，不能从提供商消息键中猜测。
ALTER TABLE mail_message_refs ADD COLUMN folder_id TEXT NOT NULL DEFAULT 'INBOX';
