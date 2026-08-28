INSERT INTO `application_settings` (`key`, `value_json`, `schema_version`, `updated_at`)
VALUES (
  'sources.activeChannel',
  '{"channel":"intern"}',
  '1',
  CAST(unixepoch('subsec') * 1000 AS integer)
)
ON CONFLICT(`key`) DO NOTHING;
--> statement-breakpoint
UPDATE `source_channels`
SET `enabled` = CASE
      WHEN `channel` = COALESCE(
        (SELECT json_extract(`value_json`, '$.channel')
         FROM `application_settings`
         WHERE `key` = 'sources.activeChannel'),
        'intern'
      )
      AND EXISTS (
        SELECT 1 FROM `job_sources` source
        WHERE source.`channel_id` = `source_channels`.`id`
          AND source.`support_status` = 'supported'
      ) THEN 1 ELSE 0 END,
    `updated_at` = CAST(unixepoch('subsec') * 1000 AS integer);
--> statement-breakpoint
UPDATE `schedules`
SET `enabled` = CASE WHEN EXISTS (
      SELECT 1 FROM `job_sources` source
      JOIN `source_channels` channel ON channel.`id` = source.`channel_id`
      WHERE `schedules`.`schedule_key` = 'source.sync:' || source.`id`
        AND channel.`enabled` = 1
    ) THEN 1 ELSE 0 END,
    `updated_at` = CAST(unixepoch('subsec') * 1000 AS integer)
WHERE `task_type` = 'source.sync';
--> statement-breakpoint
UPDATE `tasks`
SET `status` = 'cancelled',
    `error_category` = 'cancelled',
    `error_summary` = 'The selected recruitment channel changed.',
    `finished_at` = CAST(unixepoch('subsec') * 1000 AS integer)
WHERE `task_type` = 'source.sync'
  AND `status` = 'pending'
  AND EXISTS (
    SELECT 1 FROM `job_sources` source
    JOIN `source_channels` channel ON channel.`id` = source.`channel_id`
    WHERE source.`id` = json_extract(`tasks`.`payload_json`, '$.sourceId')
      AND channel.`enabled` = 0
  );
