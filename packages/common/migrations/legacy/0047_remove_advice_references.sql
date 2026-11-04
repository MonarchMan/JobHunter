-- 删除历史建议引用和简历重点，保留建议正文与原运行身份。
UPDATE match_advices SET result_json = json_object('highlights', json((SELECT coalesce(json_group_array(json_object('text', migration_regexp_replace(json_extract(value, '$.text'), '\s*[（(【\[]?ref-[0-9]+(?:\s*[,，、]\s*ref-[0-9]+)*[）)】\]]?', ''))), '[]') FROM json_each(result_json, '$.highlights'))),
  'gaps', json((SELECT coalesce(json_group_array(json_object('text', migration_regexp_replace(json_extract(value, '$.text'), '\s*[（(【\[]?ref-[0-9]+(?:\s*[,，、]\s*ref-[0-9]+)*[）)】\]]?', ''))), '[]') FROM json_each(result_json, '$.gaps'))),
  'uncertainties', json((SELECT coalesce(json_group_array(json_object('text', migration_regexp_replace(json_extract(value, '$.text'), '\s*[（(【\[]?ref-[0-9]+(?:\s*[,，、]\s*ref-[0-9]+)*[）)】\]]?', ''))), '[]') FROM json_each(result_json, '$.uncertainties'))),
  'preparation', json((SELECT coalesce(json_group_array(migration_regexp_replace(value, '\s*[（(【\[]?ref-[0-9]+(?:\s*[,，、]\s*ref-[0-9]+)*[）)】\]]?', '')), '[]') FROM json_each(result_json, '$.preparation')))) WHERE json_type(result_json, '$.resumeEmphasis') IS NOT NULL OR EXISTS (SELECT 1 FROM json_tree(result_json) WHERE key = 'references') OR result_json GLOB '*ref-[0-9]*';
--> statement-breakpoint
UPDATE match_advices SET content_hash = migration_json_hash(result_json);
--> statement-breakpoint
UPDATE agent_runs SET output_json = json_object('highlights', json((SELECT coalesce(json_group_array(json_object('text', migration_regexp_replace(json_extract(value, '$.text'), '\s*[（(【\[]?ref-[0-9]+(?:\s*[,，、]\s*ref-[0-9]+)*[）)】\]]?', ''))), '[]') FROM json_each(output_json, '$.highlights'))),
  'gaps', json((SELECT coalesce(json_group_array(json_object('text', migration_regexp_replace(json_extract(value, '$.text'), '\s*[（(【\[]?ref-[0-9]+(?:\s*[,，、]\s*ref-[0-9]+)*[）)】\]]?', ''))), '[]') FROM json_each(output_json, '$.gaps'))),
  'uncertainties', json((SELECT coalesce(json_group_array(json_object('text', migration_regexp_replace(json_extract(value, '$.text'), '\s*[（(【\[]?ref-[0-9]+(?:\s*[,，、]\s*ref-[0-9]+)*[）)】\]]?', ''))), '[]') FROM json_each(output_json, '$.uncertainties'))),
  'preparation', json((SELECT coalesce(json_group_array(migration_regexp_replace(value, '\s*[（(【\[]?ref-[0-9]+(?:\s*[,，、]\s*ref-[0-9]+)*[）)】\]]?', '')), '[]') FROM json_each(output_json, '$.preparation')))) WHERE agent_key = 'job-advice' AND output_json IS NOT NULL;
--> statement-breakpoint
UPDATE agent_runs SET output_hash = migration_json_hash(output_json) WHERE agent_key = 'job-advice' AND output_json IS NOT NULL;
