ALTER TABLE `experience_research_requests`
  ADD COLUMN `bundle_import_token` text;
--> statement-breakpoint
ALTER TABLE `experience_research_requests`
  ADD COLUMN `bundle_import_claimed_at` integer;
--> statement-breakpoint
ALTER TABLE `experience_research_requests`
  ADD COLUMN `bundle_import_file_id` text;
--> statement-breakpoint
CREATE TRIGGER `experience_research_requests_bundle_claim_insert_check`
BEFORE INSERT ON `experience_research_requests`
WHEN NOT (
  (`NEW`.`bundle_import_token` IS NULL
    AND `NEW`.`bundle_import_claimed_at` IS NULL
    AND `NEW`.`bundle_import_file_id` IS NULL)
  OR
  (`NEW`.`bundle_import_token` IS NOT NULL
    AND length(trim(`NEW`.`bundle_import_token`)) > 0
    AND `NEW`.`bundle_import_claimed_at` IS NOT NULL
    AND `NEW`.`bundle_import_claimed_at` >= 0
    AND `NEW`.`bundle_import_file_id` IS NOT NULL
    AND length(trim(`NEW`.`bundle_import_file_id`)) > 0)
)
BEGIN
  SELECT RAISE(ABORT, 'invalid research bundle import claim');
END;
--> statement-breakpoint
CREATE TRIGGER `experience_research_requests_bundle_claim_update_check`
BEFORE UPDATE OF `bundle_import_token`, `bundle_import_claimed_at`, `bundle_import_file_id`
ON `experience_research_requests`
WHEN NOT (
  (`NEW`.`bundle_import_token` IS NULL
    AND `NEW`.`bundle_import_claimed_at` IS NULL
    AND `NEW`.`bundle_import_file_id` IS NULL)
  OR
  (`NEW`.`bundle_import_token` IS NOT NULL
    AND length(trim(`NEW`.`bundle_import_token`)) > 0
    AND `NEW`.`bundle_import_claimed_at` IS NOT NULL
    AND `NEW`.`bundle_import_claimed_at` >= 0
    AND `NEW`.`bundle_import_file_id` IS NOT NULL
    AND length(trim(`NEW`.`bundle_import_file_id`)) > 0)
)
BEGIN
  SELECT RAISE(ABORT, 'invalid research bundle import claim');
END;
