UPDATE `jobs`
SET `recruitment_category` = 'social',
    `employment_type` = CASE
      WHEN `employment_type` = '实习' THEN '全职'
      ELSE `employment_type`
    END
WHERE `recruitment_category` = 'internship'
  AND `source_id` IN (
    SELECT `id` FROM `job_sources` WHERE `adapter_key` IN (
      'bytedance.social',
      'meituan.social',
      'tencent.social'
    )
  );
--> statement-breakpoint

UPDATE `job_sources`
SET `base_url` = 'https://campus.jd.com/#/jobs'
WHERE `adapter_key` = 'jd.campus';
--> statement-breakpoint

UPDATE `job_sources`
SET `base_url` = 'https://job.xiaohongshu.com/campus/position'
WHERE `adapter_key` = 'xiaohongshu.campus';
--> statement-breakpoint

UPDATE `jobs`
SET `detail_url` = 'https://campus-talent.alibaba.com/campus/position/' || `external_job_id`,
    `apply_url` = 'https://campus-talent.alibaba.com/campus/position/' || `external_job_id`
WHERE `source_id` IN (
  SELECT `id` FROM `job_sources` WHERE `adapter_key` = 'alibaba.campus'
);
--> statement-breakpoint

UPDATE `jobs`
SET `detail_url` = 'https://job.xiaohongshu.com/campus/position/' || `external_job_id`,
    `apply_url` = 'https://job.xiaohongshu.com/campus/position/' || `external_job_id`
WHERE `source_id` IN (
  SELECT `id` FROM `job_sources` WHERE `adapter_key` = 'xiaohongshu.campus'
);
--> statement-breakpoint

UPDATE `jobs`
SET `detail_url` = 'https://campus.jd.com/#/details?id=' || `external_job_id` || '&type=present',
    `apply_url` = 'https://campus.jd.com/#/details?id=' || `external_job_id` || '&type=present'
WHERE `source_id` IN (
  SELECT `id` FROM `job_sources` WHERE `adapter_key` = 'jd.campus'
);
--> statement-breakpoint

UPDATE `jobs`
SET `detail_url` = 'https://career.huawei.com/cn/job-details?advertisementId=' || (
      SELECT CAST(json_extract(`raw_job_records`.`payload_json`, '$.discovered.advertisementId') AS TEXT)
      FROM `raw_job_records`
      WHERE `raw_job_records`.`source_id` = `jobs`.`source_id`
        AND `raw_job_records`.`external_job_id` = `jobs`.`external_job_id`
        AND json_extract(`raw_job_records`.`payload_json`, '$.discovered.advertisementId') IS NOT NULL
      ORDER BY `raw_job_records`.`captured_at` DESC
      LIMIT 1
    ),
    `apply_url` = 'https://career.huawei.com/cn/job-details?advertisementId=' || (
      SELECT CAST(json_extract(`raw_job_records`.`payload_json`, '$.discovered.advertisementId') AS TEXT)
      FROM `raw_job_records`
      WHERE `raw_job_records`.`source_id` = `jobs`.`source_id`
        AND `raw_job_records`.`external_job_id` = `jobs`.`external_job_id`
        AND json_extract(`raw_job_records`.`payload_json`, '$.discovered.advertisementId') IS NOT NULL
      ORDER BY `raw_job_records`.`captured_at` DESC
      LIMIT 1
    )
WHERE `source_id` IN (
  SELECT `id` FROM `job_sources` WHERE `adapter_key` = 'huawei.campus'
)
AND EXISTS (
  SELECT 1 FROM `raw_job_records`
  WHERE `raw_job_records`.`source_id` = `jobs`.`source_id`
    AND `raw_job_records`.`external_job_id` = `jobs`.`external_job_id`
    AND json_extract(`raw_job_records`.`payload_json`, '$.discovered.advertisementId') IS NOT NULL
);
