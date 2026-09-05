-- 1、单例维护状态与检查摘要；PID 仅用于同一本机的跨进程协调。
CREATE TABLE database_maintenance (
 id INTEGER PRIMARY KEY CHECK(id = 1),
 next_check_at INTEGER NOT NULL DEFAULT 0,
 last_daily_at INTEGER,
 last_vacuum_at INTEGER,
 vacuum_pending INTEGER NOT NULL DEFAULT 0,
 owner_pid INTEGER,
 task_id TEXT,
 summary_json TEXT
);
--> statement-breakpoint
INSERT INTO database_maintenance(id) VALUES(1);
