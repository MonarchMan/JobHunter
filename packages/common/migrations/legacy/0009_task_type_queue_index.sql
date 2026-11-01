DROP INDEX `tasks_claim_idx`;
--> statement-breakpoint
CREATE INDEX `tasks_claim_idx` ON `tasks` (`task_type`, `status`, `available_at`, `priority` DESC, `created_at`);
