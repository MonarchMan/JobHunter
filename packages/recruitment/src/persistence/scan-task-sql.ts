/** 来源诊断的 SQL 投影；扫描事实只存于 tasks，不建立旧表或兼容视图。 */
export const scanTaskProjection = `(SELECT rowid, id, parent_task_id, source_id,
  json_extract(private_state, '$.trigger') AS trigger,
  CASE WHEN status = 'succeeded' THEN COALESCE(json_extract(public_state, '$.status'), status) ELSE status END AS status,
  COALESCE(json_extract(public_state, '$.coverage'), 'unknown') AS coverage,
  CASE WHEN json_type(private_state,'$.cursorOut') IS NOT NULL AND json_type(private_state,'$.cursorOut')!='null'
    THEN private_state -> '$.cursorOut' END AS cursor_out_json,
  COALESCE(json_extract(public_state, '$.stats'), '{}') AS stats_json,
  COALESCE(json_extract(public_state, '$.coverageEvidence'), '{}') AS coverage_evidence_json,
  error_category, error_summary, started_at, finished_at
  FROM tasks WHERE task_type = 'source.scan')`;
