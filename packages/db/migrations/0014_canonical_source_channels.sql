UPDATE `job_sources`
SET `slug` = 'bytedance-campus'
WHERE `id` = '018f0000-0000-7000-8000-000000000213'
  AND `slug` = 'bytedance-intern';
--> statement-breakpoint

UPDATE `job_sources`
SET `slug` = 'pinduoduo-intern'
WHERE `id` = '018f0000-0000-7000-8000-000000000205'
  AND `slug` = 'pinduoduo-campus';
--> statement-breakpoint

UPDATE `job_sources`
SET `slug` = 'jd-intern',
    `adapter_key` = 'jd.intern'
WHERE `id` = '018f0000-0000-7000-8000-000000000209';
--> statement-breakpoint

UPDATE `job_sources`
SET `slug` = 'huawei-intern',
    `adapter_key` = 'huawei.intern'
WHERE `id` = '018f0000-0000-7000-8000-000000000210';
--> statement-breakpoint

UPDATE `job_sources`
SET `slug` = 'netease-social',
    `adapter_key` = 'netease.social',
    `recruitment_type` = 'social'
WHERE `id` = '018f0000-0000-7000-8000-000000000218';
