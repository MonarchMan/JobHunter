-- 历史运行保留审计，但没有当前定义内容，不能作为新缓存复用。
ALTER TABLE agent_runs ADD COLUMN definition_hash TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
UPDATE agent_runs SET definition_hash = 'historical:' || id;
--> statement-breakpoint
ALTER TABLE agent_runs DROP COLUMN agent_version;
--> statement-breakpoint
ALTER TABLE agent_runs DROP COLUMN prompt_version;
--> statement-breakpoint
-- 保留历史结果的外键身份；删除版本唯一约束，不再加载旧引擎。
CREATE TABLE match_rulesets_new (
  id TEXT PRIMARY KEY NOT NULL,
  definition_json TEXT NOT NULL,
  definition_hash TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL CHECK(active IN (0, 1)),
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
INSERT INTO match_rulesets_new SELECT id, definition_json, definition_hash, 0, created_at FROM match_rulesets;
--> statement-breakpoint
DROP TABLE match_rulesets;
--> statement-breakpoint
ALTER TABLE match_rulesets_new RENAME TO match_rulesets;
--> statement-breakpoint
CREATE UNIQUE INDEX match_rulesets_one_active_idx ON match_rulesets(active) WHERE active = 1;
