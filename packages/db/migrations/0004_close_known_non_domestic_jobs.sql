UPDATE `jobs`
SET `status` = 'closed',
    `closed_at` = COALESCE(`closed_at`, `updated_at`),
    `updated_at` = `updated_at`
WHERE `status` IN ('active', 'stale')
  AND (
    lower(`locations_json`) LIKE '%利雅得%'
    OR lower(`locations_json`) LIKE '%迪拜%'
    OR lower(`locations_json`) LIKE '%多哈%'
    OR lower(`locations_json`) LIKE '%riyadh%'
    OR lower(`locations_json`) LIKE '%dubai%'
    OR lower(`locations_json`) LIKE '%doha%'
  );
