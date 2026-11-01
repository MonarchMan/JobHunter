UPDATE `sync_runs`
SET `stats_json` = json_object(
  'closed', COALESCE(json_extract(`stats_json`, '$.closed'), 0),
  'created', COALESCE(json_extract(`stats_json`, '$.created'), 0),
  'discovered', COALESCE(json_extract(`stats_json`, '$.discovered'), 0),
  'followupEnqueued', COALESCE(json_extract(`stats_json`, '$.followupEnqueued'), 0),
  'isolated', COALESCE(json_extract(`stats_json`, '$.isolated'), 0),
  'restored', COALESCE(json_extract(`stats_json`, '$.restored'), 0),
  'revised', COALESCE(json_extract(`stats_json`, '$.revised'), 0),
  'skippedNonDomestic', COALESCE(json_extract(`stats_json`, '$.skippedNonDomestic'), 0),
  'skippedOutOfScope', COALESCE(json_extract(`stats_json`, '$.skippedOutOfScope'), 0),
  'skippedUnknownRegion', COALESCE(json_extract(`stats_json`, '$.skippedUnknownRegion'), 0),
  'staled', COALESCE(json_extract(`stats_json`, '$.staled'), 0),
  'unchanged', COALESCE(json_extract(`stats_json`, '$.unchanged'), 0)
);
