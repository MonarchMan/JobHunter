UPDATE job_sources
SET sync_policy_json = json_set(sync_policy_json, '$.enrichNewRevisions', json('false')),
    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000;
