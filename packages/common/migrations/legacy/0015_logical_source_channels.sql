CREATE TABLE `source_channels` (
  `id` text PRIMARY KEY NOT NULL,
  `company_id` text NOT NULL REFERENCES `companies`(`id`) ON DELETE RESTRICT,
  `channel` text NOT NULL CHECK (`channel` IN ('intern', 'campus', 'social')),
  `slug` text NOT NULL UNIQUE,
  `enabled` integer NOT NULL CHECK (`enabled` IN (0, 1)),
  `support_note` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  UNIQUE (`company_id`, `channel`)
);
--> statement-breakpoint
INSERT INTO `source_channels`
  (`id`, `company_id`, `channel`, `slug`, `enabled`, `support_note`, `created_at`, `updated_at`)
SELECT
  '018f0000-0000-7000-8200-' || substr(replace(company.`id`, '-', ''), -10) || kind.`code`,
  company.`id`,
  kind.`channel`,
  company.`slug` || '-' || kind.`channel`,
  CASE WHEN EXISTS (
    SELECT 1 FROM `job_sources` source
    WHERE source.`company_id` = company.`id`
      AND source.`support_status` = 'supported'
      AND CASE
        WHEN source.`adapter_key` LIKE '%.intern' THEN 'intern'
        WHEN source.`adapter_key` LIKE '%.social' THEN 'social'
        ELSE 'campus'
      END = kind.`channel`
  ) THEN 1 ELSE 0 END,
  NULL,
  CAST(unixepoch('subsec') * 1000 AS integer),
  CAST(unixepoch('subsec') * 1000 AS integer)
FROM `companies` company
CROSS JOIN (
  SELECT 'intern' AS `channel`, '01' AS `code`
  UNION ALL SELECT 'campus', '02'
  UNION ALL SELECT 'social', '03'
) kind;
--> statement-breakpoint
ALTER TABLE `job_sources` ADD COLUMN `channel_id` text REFERENCES `source_channels`(`id`) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE `job_sources` ADD COLUMN `coverage_role` text NOT NULL DEFAULT 'required'
  CHECK (`coverage_role` IN ('required', 'supplemental'));
--> statement-breakpoint
UPDATE `job_sources`
SET `channel_id` = (
  SELECT channel.`id`
  FROM `source_channels` channel
  WHERE channel.`company_id` = `job_sources`.`company_id`
    AND channel.`channel` = CASE
      WHEN `job_sources`.`adapter_key` LIKE '%.intern' THEN 'intern'
      WHEN `job_sources`.`adapter_key` LIKE '%.social' THEN 'social'
      ELSE 'campus'
    END
);
--> statement-breakpoint
UPDATE `job_sources`
SET `slug` = 'netease-campus-internet',
    `adapter_key` = 'netease.campus.internet',
    `base_url` = 'https://campus.163.com/',
    `support_note` = '网易互联网校招官网协议尚未完成匿名门禁.'
WHERE `id` = '018f0000-0000-7000-8000-000000000245'
  AND `slug` = 'netease-campus';
--> statement-breakpoint
CREATE UNIQUE INDEX `job_sources_adapter_key_unique` ON `job_sources` (`adapter_key`);
--> statement-breakpoint
CREATE TRIGGER `job_sources_channel_required_insert`
BEFORE INSERT ON `job_sources`
WHEN NEW.`channel_id` IS NULL
BEGIN
  SELECT RAISE(ABORT, 'job_sources.channel_id is required');
END;
--> statement-breakpoint
CREATE TRIGGER `job_sources_channel_required_update`
BEFORE UPDATE OF `channel_id` ON `job_sources`
WHEN NEW.`channel_id` IS NULL
BEGIN
  SELECT RAISE(ABORT, 'job_sources.channel_id is required');
END;
--> statement-breakpoint
CREATE TRIGGER `job_sources_channel_company_insert`
BEFORE INSERT ON `job_sources`
WHEN NOT EXISTS (
  SELECT 1 FROM `source_channels` channel
  WHERE channel.`id` = NEW.`channel_id` AND channel.`company_id` = NEW.`company_id`
)
BEGIN
  SELECT RAISE(ABORT, 'job source and channel must belong to the same company');
END;
--> statement-breakpoint
CREATE TRIGGER `job_sources_channel_company_update`
BEFORE UPDATE OF `channel_id`, `company_id` ON `job_sources`
WHEN NOT EXISTS (
  SELECT 1 FROM `source_channels` channel
  WHERE channel.`id` = NEW.`channel_id` AND channel.`company_id` = NEW.`company_id`
)
BEGIN
  SELECT RAISE(ABORT, 'job source and channel must belong to the same company');
END;
