ALTER TABLE `match_results` ADD COLUMN `model_score` real CHECK (`model_score` IS NULL OR (`model_score` >= 0 AND `model_score` <= 100));
--> statement-breakpoint
ALTER TABLE `match_results` ADD COLUMN `scoring_version` text NOT NULL DEFAULT 'rules-v1';
