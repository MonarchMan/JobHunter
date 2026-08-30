UPDATE `schedules`
SET `payload_json` = '{"sourceDetailsDays":30,"observationsDays":90,"failedAgentRunsDays":30}',
    `updated_at` = 1788382800000
WHERE `task_type` = 'maintenance.cleanup';
