CREATE TABLE `resume_polish_suggestions` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`source_version_id` text NOT NULL,
	`sections_json` text NOT NULL,
	`result_json` text NOT NULL,
	`agent_run_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `candidate_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_version_id`) REFERENCES `profile_versions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `resume_polish_suggestions_profile_idx` ON `resume_polish_suggestions` (`profile_id`, `created_at`);
