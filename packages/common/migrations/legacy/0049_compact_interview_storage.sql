-- 迁移连接已关闭外键检查；保留子表引用的档案 ID 与快照证据 ID。
-- 拒绝不成对的历史记录，避免 JOIN 搬运时静默丢失孤立快照或档案。
CREATE TEMP TABLE interview_storage_guard (invalid_count INTEGER CHECK(invalid_count = 0));
--> statement-breakpoint
INSERT INTO interview_storage_guard SELECT
  (SELECT count(*) FROM resume_project_snapshots s WHERE NOT EXISTS (SELECT 1 FROM project_dossiers d WHERE d.snapshot_id = s.id)) +
  (SELECT count(*) FROM project_dossiers d WHERE NOT EXISTS (SELECT 1 FROM resume_project_snapshots s WHERE s.id = d.snapshot_id));
--> statement-breakpoint
DROP TABLE interview_storage_guard;
--> statement-breakpoint
CREATE TABLE project_dossiers_new (
  id TEXT PRIMARY KEY NOT NULL,
  snapshot_id TEXT NOT NULL UNIQUE,
  source_profile_id TEXT NOT NULL,
  source_profile_version_id TEXT NOT NULL,
  project_index INTEGER NOT NULL CHECK(project_index >= 0),
  project_json TEXT NOT NULL CHECK(json_valid(project_json)),
  content_hash TEXT NOT NULL CHECK(length(content_hash) = 64),
  snapshot_created_at INTEGER NOT NULL,
  notebook_file_id TEXT REFERENCES files(id) ON DELETE RESTRICT,
  notebook_source_hash TEXT CHECK(notebook_source_hash IS NULL OR length(notebook_source_hash) = 64),
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(source_profile_version_id, project_index, content_hash)
);
--> statement-breakpoint
INSERT INTO project_dossiers_new
SELECT d.id, d.snapshot_id, s.source_profile_id, s.source_profile_version_id,
       s.project_index, s.project_json, s.content_hash, s.created_at,
       d.notebook_file_id, d.notebook_source_hash, d.revision, d.created_at, d.updated_at
FROM project_dossiers d JOIN resume_project_snapshots s ON s.id = d.snapshot_id;
--> statement-breakpoint
DROP TABLE project_dossiers;
--> statement-breakpoint
ALTER TABLE project_dossiers_new RENAME TO project_dossiers;
--> statement-breakpoint
CREATE INDEX project_dossiers_updated_idx ON project_dossiers(updated_at DESC);
--> statement-breakpoint
ALTER TABLE drill_sessions ADD COLUMN coverage_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(coverage_json) AND json_type(coverage_json) = 'object');
--> statement-breakpoint
UPDATE drill_sessions SET coverage_json = (
  SELECT json_group_object(dimension, json_object(
    'status', status, 'evidenceItemIds', json(evidence_item_ids_json), 'updatedAt', updated_at
  )) FROM drill_coverage WHERE session_id = drill_sessions.id
);
--> statement-breakpoint
DROP TABLE drill_coverage;
--> statement-breakpoint
DROP TABLE resume_project_snapshots;
