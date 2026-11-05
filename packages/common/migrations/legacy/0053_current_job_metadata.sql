-- 1、当前职位直接承载内容身份；保留旧身份以便已排队任务继续校验输入。
DROP TRIGGER job_content_replace;
--> statement-breakpoint
DROP TRIGGER job_content_retire;
--> statement-breakpoint
ALTER TABLE jobs ADD COLUMN content_id TEXT;
--> statement-breakpoint
ALTER TABLE jobs ADD COLUMN source_payload_hash TEXT CHECK(source_payload_hash IS NULL OR length(source_payload_hash)=64);
--> statement-breakpoint
ALTER TABLE jobs ADD COLUMN source_url TEXT;
--> statement-breakpoint
UPDATE jobs SET source_payload_hash=(SELECT source_payload_hash FROM job_revisions WHERE job_id=jobs.id),source_url=(SELECT source_url FROM job_revisions WHERE job_id=jobs.id);
--> statement-breakpoint
UPDATE jobs SET content_id = COALESCE((SELECT id FROM job_revisions WHERE job_id=jobs.id), id);
--> statement-breakpoint
CREATE UNIQUE INDEX jobs_content_id_idx ON jobs(content_id);
--> statement-breakpoint
CREATE TABLE job_metadata (
 id TEXT PRIMARY KEY NOT NULL,
 job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
 name TEXT NOT NULL CHECK(name IN ('enrichment','match_result','match_advice')),
 value TEXT NOT NULL CHECK(json_valid(value) AND json_type(value)='object'),
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 UNIQUE(job_id,name)
);
--> statement-breakpoint
-- 2、每类仅保留当前内容的最新结果，评分只保留精简字段。
INSERT INTO job_metadata
SELECT e.id,r.job_id,'enrichment',json_object('content_id',r.id,'agent_run_id',e.agent_run_id,
 'schema',e.schema_version,'content_hash',e.content_hash,'result',json(e.result_json)),e.created_at,e.created_at
FROM job_enrichments e JOIN job_revisions r ON r.id=e.job_revision_id
WHERE e.id=(SELECT id FROM job_enrichments WHERE job_revision_id=r.id ORDER BY created_at DESC,id DESC LIMIT 1);
--> statement-breakpoint
INSERT INTO job_metadata
SELECT m.id,r.job_id,'match_result',json_object(
 'content_id',r.id,'profile_version_id',m.profile_version_id,'enrichment_id',m.job_enrichment_id,
 'rules_hash',rs.definition_hash,'filter_status',m.filter_status,'total_score',m.total_score,
 'input_hash',m.input_hash,
 'components',json((SELECT json_group_array(json_object('dimension',json_extract(c.value,'$.dimension'),'score',json_extract(c.value,'$.score'),'max_score',json_extract(c.value,'$.maximumScore'))) FROM json_each(m.components_json) c WHERE json_extract(c.value,'$.dimension')!='model')),
 'risk_results',json((SELECT json_group_array(DISTINCT json_extract(o.value,'$.ruleId')) FROM json_each(m.risks_json) o WHERE json_extract(o.value,'$.status')='fail')),
 'unknown_rules',json((SELECT json_group_array(DISTINCT json_extract(o.value,'$.ruleId')) FROM json_each(m.risks_json) o WHERE json_extract(o.value,'$.status')='unknown')),
 'model',json(CASE WHEN m.model_score IS NULL THEN 'null' ELSE json_object('score',m.model_score,'reasons',json((SELECT json_group_array(json_extract(e.value,'$.summary')) FROM json_each(m.components_json) c,json_each(json_extract(c.value,'$.matchedEvidence')) e WHERE json_extract(c.value,'$.dimension')='model'))) END)
),m.created_at,m.created_at
FROM match_results m JOIN job_revisions r ON r.id=m.job_revision_id JOIN match_rulesets rs ON rs.id=m.ruleset_id
WHERE m.id=(SELECT id FROM match_results WHERE job_revision_id=r.id ORDER BY created_at DESC,id DESC LIMIT 1);
--> statement-breakpoint
INSERT INTO job_metadata
SELECT a.id,m.job_id,'match_advice',json_object('match_result_id',m.id,'match_input_hash',json_extract(m.value,'$.input_hash'),
 'agent_run_id',a.agent_run_id,'schema',a.schema_version,'content_hash',a.content_hash,'result',json(a.result_json)),a.created_at,a.created_at
FROM match_advices a JOIN job_metadata m ON m.name='match_result' AND m.id=a.match_result_id
WHERE a.id=(SELECT id FROM match_advices WHERE match_result_id=m.id ORDER BY created_at DESC,id DESC LIMIT 1);
--> statement-breakpoint
-- 3、观测只保存职位与观测来源，不再依赖内容记录。
CREATE TABLE job_observations_next (
 job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
 sync_run_id TEXT REFERENCES sync_runs(id) ON DELETE RESTRICT,
 observed_at INTEGER NOT NULL,
 platform_task_id TEXT REFERENCES tasks(id) ON DELETE RESTRICT,
 CHECK ((sync_run_id IS NOT NULL AND platform_task_id IS NULL) OR (sync_run_id IS NULL AND platform_task_id IS NOT NULL)),
 UNIQUE(job_id,sync_run_id), UNIQUE(job_id,platform_task_id)
);
--> statement-breakpoint
INSERT INTO job_observations_next SELECT job_id,sync_run_id,observed_at,platform_task_id FROM job_observations;
--> statement-breakpoint
DROP TABLE job_observations;
--> statement-breakpoint
ALTER TABLE job_observations_next RENAME TO job_observations;
--> statement-breakpoint
DROP TABLE match_advices;
--> statement-breakpoint
DROP TABLE match_results;
--> statement-breakpoint
DROP TABLE job_enrichments;
--> statement-breakpoint
DROP TABLE match_rulesets;
--> statement-breakpoint
DROP TABLE job_revisions;
--> statement-breakpoint
CREATE INDEX job_metadata_score_idx ON job_metadata(json_extract(value,'$.profile_version_id'),json_extract(value,'$.total_score') DESC) WHERE name='match_result';
--> statement-breakpoint
-- 4、职位内容变化原子失效派生结果，已开始的任务必须再次校验内容身份。
CREATE TRIGGER jobs_metadata_invalidate AFTER UPDATE OF content_hash ON jobs
WHEN OLD.content_hash != NEW.content_hash
BEGIN
 UPDATE tasks SET status='cancelled',finished_at=CAST(unixepoch('subsec')*1000 AS INTEGER),
 cancel_requested_at=COALESCE(cancel_requested_at,CAST(unixepoch('subsec')*1000 AS INTEGER)),
 lease_owner=NULL,lease_expires_at=NULL,error_category='cancelled',error_summary='职位内容已更新，请针对当前内容重新评分。'
 WHERE status IN ('pending','running') AND task_type IN ('job.enrich','match.score-job','match.compute-revision','match.advise')
 AND (json_extract(payload_json,'$.jobRevisionId')=OLD.content_id OR json_extract(payload_json,'$.matchResultId') IN (SELECT id FROM job_metadata WHERE job_id=OLD.id AND name='match_result'));
 DELETE FROM job_metadata WHERE job_id=NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER metadata_advice_invalidate AFTER UPDATE OF value ON job_metadata
WHEN NEW.name='match_result' AND json_extract(OLD.value,'$.input_hash') != json_extract(NEW.value,'$.input_hash')
BEGIN
 DELETE FROM job_metadata WHERE job_id=NEW.job_id AND name='match_advice';
END;
--> statement-breakpoint
CREATE TRIGGER metadata_advice_delete AFTER DELETE ON job_metadata
WHEN OLD.name='match_result'
BEGIN
 DELETE FROM job_metadata WHERE job_id=OLD.job_id AND name='match_advice';
END;
