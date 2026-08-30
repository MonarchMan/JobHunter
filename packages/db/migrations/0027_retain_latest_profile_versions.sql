DELETE FROM `match_results`
WHERE `profile_version_id` IN (
  SELECT `id`
  FROM (
    SELECT
      `id`,
      ROW_NUMBER() OVER (
        PARTITION BY `profile_id`
        ORDER BY `version_no` DESC, `id` DESC
      ) AS `retention_rank`
    FROM `profile_versions`
  )
  WHERE `retention_rank` > 5
);
--> statement-breakpoint
DELETE FROM `profile_versions`
WHERE `id` IN (
  SELECT `id`
  FROM (
    SELECT
      `id`,
      ROW_NUMBER() OVER (
        PARTITION BY `profile_id`
        ORDER BY `version_no` DESC, `id` DESC
      ) AS `retention_rank`
    FROM `profile_versions`
  )
  WHERE `retention_rank` > 5
);
