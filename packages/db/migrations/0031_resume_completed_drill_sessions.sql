DROP INDEX `drill_sessions_one_open_per_dossier_idx`;
--> statement-breakpoint
CREATE UNIQUE INDEX `drill_sessions_one_active_per_dossier_idx`
  ON `drill_sessions` (`dossier_id`) WHERE `status` = 'active';
