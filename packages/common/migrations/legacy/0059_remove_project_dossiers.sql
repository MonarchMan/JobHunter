-- 会话已在 0058 关联当前画像项目；只删除系统管理的旧档案与材料索引。
DROP TABLE project_dossiers;
--> statement-breakpoint
CREATE TEMP TABLE removed_project_entities AS SELECT entity_id FROM file_entity_mappings WHERE file_id IN (SELECT id FROM files WHERE kind IN ('project_material','project_notebook'));
--> statement-breakpoint
DELETE FROM file_entity_mappings WHERE file_id IN (SELECT id FROM files WHERE kind IN ('project_material','project_notebook'));
--> statement-breakpoint
DELETE FROM files WHERE kind IN ('project_material','project_notebook');
--> statement-breakpoint
DELETE FROM entities WHERE id IN (SELECT entity_id FROM removed_project_entities) AND NOT EXISTS (SELECT 1 FROM file_entity_mappings WHERE entity_id=entities.id);
--> statement-breakpoint
DROP TABLE removed_project_entities;
