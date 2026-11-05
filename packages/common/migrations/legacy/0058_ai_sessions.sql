-- 会话与消息独立于项目生命周期；可选关系仅放入元数据。
CREATE TABLE ai_sessions (
 id TEXT PRIMARY KEY NOT NULL,
 type TEXT NOT NULL CHECK(type IN ('interview','chat')),
 title TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE ai_messages (
 id TEXT PRIMARY KEY NOT NULL,
 session_id TEXT NOT NULL REFERENCES ai_sessions(id) ON DELETE CASCADE,
 role TEXT NOT NULL CHECK(role IN ('user','assistant')),
 content TEXT NOT NULL,
 sequence INTEGER NOT NULL CHECK(sequence>0),
 status TEXT NOT NULL CHECK(status IN ('pending','completed','failed','cancelled')),
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 UNIQUE(session_id,sequence)
);
--> statement-breakpoint
CREATE UNIQUE INDEX ai_messages_one_pending ON ai_messages(session_id) WHERE status='pending';
--> statement-breakpoint
CREATE UNIQUE INDEX tasks_ai_message_idx ON tasks(json_extract(private_state,'$.messageId')) WHERE task_type='ai.reply';
--> statement-breakpoint
CREATE TABLE ai_session_metadata (
 id TEXT PRIMARY KEY NOT NULL,
 session_id TEXT NOT NULL REFERENCES ai_sessions(id) ON DELETE CASCADE,
 name TEXT NOT NULL,
 value TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 UNIQUE(session_id,name)
);
--> statement-breakpoint
INSERT INTO ai_sessions SELECT s.id,'interview',COALESCE(json_extract(d.project_json,'$.name'),'模拟面试'),s.created_at,s.updated_at
 FROM drill_sessions s JOIN project_dossiers d ON d.id=s.dossier_id;
--> statement-breakpoint
INSERT INTO ai_session_metadata
 SELECT s.id || ':profile_id',s.id,'profile_id',d.source_profile_id,s.created_at,s.updated_at
 FROM drill_sessions s JOIN project_dossiers d ON d.id=s.dossier_id JOIN candidate_profiles p ON p.id=d.source_profile_id;
--> statement-breakpoint
INSERT INTO ai_session_metadata
 SELECT s.id || ':project_id',s.id,'project_id',json_extract(project.value,'$.id'),s.created_at,s.updated_at
 FROM drill_sessions s JOIN project_dossiers d ON d.id=s.dossier_id
 JOIN profile_versions p ON p.profile_id=d.source_profile_id AND p.is_current=1, json_each(p.projects_json) project
 WHERE project.key=d.project_index AND json_extract(project.value,'$.name')=json_extract(d.project_json,'$.name');
--> statement-breakpoint
INSERT INTO ai_messages
 SELECT id,session_id,'assistant',COALESCE(question,''),turn_no*2-1,
 CASE WHEN question IS NOT NULL THEN 'completed' ELSE 'cancelled' END,created_at,updated_at FROM drill_turns;
--> statement-breakpoint
INSERT INTO ai_messages
 SELECT r.id,t.session_id,'user',r.answer_text,t.turn_no*2,'completed',r.created_at,r.created_at
 FROM drill_turns t JOIN drill_answer_revisions r ON r.turn_id=t.id
 WHERE r.revision_no=(SELECT MAX(latest.revision_no) FROM drill_answer_revisions latest WHERE latest.turn_id=t.id);
--> statement-breakpoint
ALTER TABLE model_requests ADD COLUMN ai_message_id TEXT REFERENCES ai_messages(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX model_requests_message_idx ON model_requests(ai_message_id) WHERE ai_message_id IS NOT NULL;
--> statement-breakpoint
-- 历史缓存若被多个问题共享，无法可靠推断原始消息，保持空关联而非猜测。
UPDATE model_requests SET ai_message_id=(SELECT MIN(t.id) FROM drill_turns t WHERE t.question_agent_run_id=model_requests.agent_run_id HAVING COUNT(*)=1)
 WHERE agent_run_id IN (SELECT question_agent_run_id FROM drill_turns);
--> statement-breakpoint
CREATE TRIGGER ai_profile_deleted AFTER DELETE ON candidate_profiles
BEGIN
 DELETE FROM ai_session_metadata WHERE name='project_id' AND session_id IN
 (SELECT session_id FROM ai_session_metadata WHERE name='profile_id' AND value=OLD.id);
 DELETE FROM ai_session_metadata WHERE name='profile_id' AND value=OLD.id;
END;
--> statement-breakpoint
CREATE TRIGGER ai_project_removed AFTER INSERT ON profile_versions WHEN NEW.is_current=1
BEGIN
 DELETE FROM ai_session_metadata WHERE name='project_id'
 AND session_id IN (SELECT session_id FROM ai_session_metadata WHERE name='profile_id' AND value=NEW.profile_id)
 AND value NOT IN (SELECT json_extract(value,'$.id') FROM json_each(NEW.projects_json));
END;
--> statement-breakpoint
CREATE TRIGGER ai_current_profile_removed AFTER DELETE ON profile_versions WHEN OLD.is_current=1
BEGIN
 DELETE FROM ai_session_metadata WHERE name='project_id'
 AND session_id IN (SELECT session_id FROM ai_session_metadata WHERE name='profile_id' AND value=OLD.profile_id)
 AND NOT EXISTS (SELECT 1 FROM profile_versions WHERE profile_id=OLD.profile_id AND is_current=1);
END;
--> statement-breakpoint
UPDATE tasks SET status='cancelled',finished_at=COALESCE(finished_at,available_at),lease_owner=NULL,lease_expires_at=NULL,
 error_category='cancelled',error_summary='Legacy interview workflow replaced by AI sessions.'
 WHERE task_type IN ('interview.project-question','interview.project-answer-digest','interview.project-notebook.render') AND status IN ('pending','running');
--> statement-breakpoint
-- 旧派生摘要可能包含历史回答引用；仅保留调用诊断，不另存回答旧版本。
UPDATE agent_runs SET output_json=NULL WHERE agent_key IN ('interview.project-answer-digest','interview.project-question','interview.project-question-docs');
--> statement-breakpoint
DROP TABLE project_knowledge_items;
--> statement-breakpoint
DROP TABLE drill_answer_revisions;
--> statement-breakpoint
DROP TABLE drill_turns;
--> statement-breakpoint
DROP TABLE drill_sessions;
