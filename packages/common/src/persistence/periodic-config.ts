/** 周期配置存放在现有设置存储；投影用于查询，不创建兼容视图或新表。 */
export const periodicConfigPrefix = 'task.periodic:';

/** 统一调度配置的 SQL 读模型，维护扫描和业务展示使用相同字段语义。 */
export const periodicConfigProjection = `(
  SELECT key AS setting_key,
    json_extract(value_json, '$.id') AS id,
    json_extract(value_json, '$.schedule_key') AS schedule_key,
    json_extract(value_json, '$.task_type') AS task_type,
    json_extract(value_json, '$.payload_json') AS payload_json,
    json_extract(value_json, '$.cron_expression') AS cron_expression,
    json_extract(value_json, '$.timezone') AS timezone,
    json_extract(value_json, '$.enabled') AS enabled,
    json_extract(value_json, '$.next_run_at') AS next_run_at,
    json_extract(value_json, '$.last_enqueued_at') AS last_enqueued_at,
    json_extract(value_json, '$.created_at') AS created_at,
    json_extract(value_json, '$.updated_at') AS updated_at
  FROM application_settings WHERE key GLOB 'task.periodic:*'
)`;
