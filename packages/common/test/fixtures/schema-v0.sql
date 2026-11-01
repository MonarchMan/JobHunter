PRAGMA user_version = 0;
CREATE TABLE legacy_metadata (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
INSERT INTO legacy_metadata (key, value) VALUES ('fixture', 'preserved');
