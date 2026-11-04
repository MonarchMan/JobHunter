ALTER TABLE experience_research_requests ADD COLUMN prompt_hash TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
UPDATE experience_research_requests SET prompt_hash = 'historical:' || id;
--> statement-breakpoint
ALTER TABLE experience_research_requests DROP COLUMN prompt_version;
