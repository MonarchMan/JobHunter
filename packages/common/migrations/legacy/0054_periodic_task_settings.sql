INSERT INTO application_settings (key, value_json, schema_version, updated_at)
SELECT 'task.periodic:' || schedule_key,
       json_object('id', id, 'schedule_key', schedule_key, 'task_type', task_type,
                   'payload_json', payload_json, 'cron_expression', cron_expression,
                   'timezone', timezone, 'enabled', enabled, 'next_run_at', next_run_at,
                   'last_enqueued_at', last_enqueued_at, 'created_at', created_at,
                   'updated_at', updated_at),
       'task-periodic@v1', updated_at
FROM schedules;
--> statement-breakpoint
ALTER TABLE tasks DROP COLUMN schedule_id;
--> statement-breakpoint
DROP TABLE schedules;
--> statement-breakpoint
CREATE INDEX task_periodic_due_idx ON application_settings
  (json_extract(value_json, '$.enabled'), json_extract(value_json, '$.next_run_at'))
  WHERE key GLOB 'task.periodic:*';
