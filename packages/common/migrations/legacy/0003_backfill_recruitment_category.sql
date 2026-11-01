UPDATE `jobs`
SET `recruitment_category` = CASE
  WHEN lower(COALESCE(`employment_type`, '')) LIKE '%实习%' THEN 'internship'
  WHEN (SELECT `recruitment_type` FROM `job_sources` WHERE `job_sources`.`id` = `jobs`.`source_id`) = 'social' THEN 'social'
  ELSE 'campus'
END
WHERE `recruitment_category` IS NULL;
