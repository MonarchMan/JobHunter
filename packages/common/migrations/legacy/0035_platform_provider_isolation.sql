CREATE TABLE platform_connections_next (
 provider_key TEXT PRIMARY KEY NOT NULL CHECK(provider_key IN ('boss','zhilian','51job','liepin')),
 generation INTEGER NOT NULL CHECK(generation>=1),
 status TEXT NOT NULL CHECK(status IN ('disconnected','connected','available','unavailable','access_blocked','rate_limited')),
 updated_at INTEGER NOT NULL
);
--> statement-breakpoint
INSERT INTO platform_connections_next SELECT * FROM platform_connections;
--> statement-breakpoint
DROP TABLE platform_connections;
--> statement-breakpoint
ALTER TABLE platform_connections_next RENAME TO platform_connections;
