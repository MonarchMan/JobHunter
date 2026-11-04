-- 请求独立于运行的生命周期；历史快照原值搬运，未知字段保持 NULL。
CREATE TABLE model_requests (
  id TEXT PRIMARY KEY NOT NULL,
  agent_run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL,
  agent_key TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('running', 'completed')),
  requested_at INTEGER NOT NULL CHECK (requested_at >= 0),
  application TEXT,
  provider TEXT,
  model TEXT NOT NULL,
  status_code INTEGER CHECK (status_code BETWEEN 100 AND 599),
  transport_error TEXT CHECK (transport_error IN ('network', 'cancelled', 'timeout', 'invalid_output')),
  duration_ms INTEGER CHECK (duration_ms >= 0),
  first_token_ms INTEGER CHECK (first_token_ms >= 0),
  input_tokens INTEGER CHECK (input_tokens >= 0),
  output_tokens INTEGER CHECK (output_tokens >= 0),
  uncached_input_tokens INTEGER CHECK (uncached_input_tokens >= 0),
  cache_read_tokens INTEGER CHECK (cache_read_tokens >= 0),
  cache_write_tokens INTEGER CHECK (cache_write_tokens >= 0),
  cache_write_5m_tokens INTEGER CHECK (cache_write_5m_tokens >= 0),
  cache_write_1h_tokens INTEGER CHECK (cache_write_1h_tokens >= 0),
  input_cost_micros INTEGER CHECK (input_cost_micros >= 0),
  output_cost_micros INTEGER CHECK (output_cost_micros >= 0),
  cache_read_cost_micros INTEGER CHECK (cache_read_cost_micros >= 0),
  cache_write_cost_micros INTEGER CHECK (cache_write_cost_micros >= 0),
  cache_write_5m_cost_micros INTEGER CHECK (cache_write_5m_cost_micros >= 0),
  cache_write_1h_cost_micros INTEGER CHECK (cache_write_1h_cost_micros >= 0),
  total_cost_micros INTEGER CHECK (total_cost_micros >= 0),
  currency TEXT NOT NULL CHECK (currency IN ('USD', 'CNY')),
  pricing_version TEXT NOT NULL,
  period TEXT NOT NULL CHECK (period IN ('peak', 'off-peak', 'fixed', 'unknown')),
  precision TEXT NOT NULL CHECK (precision IN ('reported', 'cache-miss-assumed', 'unpriced')),
  rates_json TEXT CHECK (rates_json IS NULL OR json_valid(rates_json))
);
--> statement-breakpoint
INSERT INTO model_requests (
  id, agent_run_id, agent_key, state, requested_at, application, provider, model,
  status_code, transport_error, duration_ms, first_token_ms,
  input_tokens, output_tokens, uncached_input_tokens, cache_read_tokens, cache_write_tokens,
  cache_write_5m_tokens, cache_write_1h_tokens, input_cost_micros, output_cost_micros,
  cache_read_cost_micros, cache_write_cost_micros, cache_write_5m_cost_micros,
  cache_write_1h_cost_micros, total_cost_micros, currency, pricing_version, period, precision, rates_json
)
SELECT 'legacy:' || run.id || ':' || item.key, run.id, run.agent_key, 'completed',
  json_extract(item.value, '$.requestedAt'), json_extract(item.value, '$.application'),
  json_extract(item.value, '$.provider'), json_extract(item.value, '$.model'),
  json_extract(item.value, '$.statusCode'), json_extract(item.value, '$.transportError'),
  json_extract(item.value, '$.durationMs'), json_extract(item.value, '$.firstTokenMs'),
  json_extract(item.value, '$.inputTokens'), json_extract(item.value, '$.outputTokens'),
  json_extract(item.value, '$.uncachedInputTokens'), json_extract(item.value, '$.cacheReadTokens'),
  json_extract(item.value, '$.cacheWriteTokens'), json_extract(item.value, '$.cacheWrite5mTokens'),
  json_extract(item.value, '$.cacheWrite1hTokens'), json_extract(item.value, '$.inputCostMicros'),
  json_extract(item.value, '$.outputCostMicros'), json_extract(item.value, '$.cacheReadCostMicros'),
  json_extract(item.value, '$.cacheWriteCostMicros'), json_extract(item.value, '$.cacheWrite5mCostMicros'),
  json_extract(item.value, '$.cacheWrite1hCostMicros'), json_extract(item.value, '$.totalCostMicros'),
  json_extract(item.value, '$.currency'), json_extract(item.value, '$.pricingVersion'),
  json_extract(item.value, '$.period'), json_extract(item.value, '$.precision'), json_extract(item.value, '$.rates')
FROM agent_runs run, json_each(COALESCE(run.model_usage_json, '[]')) item;
--> statement-breakpoint
CREATE INDEX model_requests_time_idx ON model_requests(requested_at DESC, id);
--> statement-breakpoint
CREATE INDEX model_requests_run_idx ON model_requests(agent_run_id, requested_at, id);
--> statement-breakpoint
CREATE INDEX model_requests_provider_time_idx ON model_requests(provider, requested_at DESC);
--> statement-breakpoint
CREATE INDEX model_requests_model_time_idx ON model_requests(model, requested_at DESC);
--> statement-breakpoint
ALTER TABLE agent_runs DROP COLUMN model_usage_json;
