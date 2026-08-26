INSERT INTO application_settings (key, value_json, schema_version, updated_at)
VALUES ('matching.jobUnderstanding', '{"enabled":false}', '1', CAST(strftime('%s', 'now') AS INTEGER) * 1000)
ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json,
  schema_version = excluded.schema_version,
  updated_at = excluded.updated_at;
