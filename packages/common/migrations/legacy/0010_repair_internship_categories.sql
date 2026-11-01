UPDATE `jobs`
SET `recruitment_category` = 'internship',
    `employment_type` = COALESCE(NULLIF(`employment_type`, '校招/实习'), '实习')
WHERE (
  lower(`title`) LIKE '%intern%'
  OR `title` LIKE '%实习%'
  OR lower(`description`) LIKE '%internship%'
  OR `description` LIKE '%日常实习%'
  OR `description` LIKE '%暑期实习%'
);
--> statement-breakpoint

UPDATE `jobs`
SET `recruitment_category` = 'internship',
    `employment_type` = '实习'
WHERE `source_id` IN (
  SELECT `id` FROM `job_sources` WHERE `adapter_key` IN (
    'huawei.campus',
    'pinduoduo.intern',
    'jd.campus',
    'tencent.intern',
    'meituan.intern'
  )
);
