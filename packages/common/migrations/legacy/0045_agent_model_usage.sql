ALTER TABLE agent_runs ADD COLUMN model_usage_json TEXT CHECK (model_usage_json IS NULL OR json_valid(model_usage_json));
