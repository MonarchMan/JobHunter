import { createTemporaryDataRoot } from '@jobhunter/testkit';
import { describe, expect, it } from 'vitest';
import { openSqliteDatabase, SqliteDashboardReadModel } from '../src/index.js';

describe('SQLite dashboard read model', () => {
  it('returns one consistent, read-only operational snapshot', async () => {
    const root = await createTemporaryDataRoot('jobhunter-dashboard-');
    const handle = openSqliteDatabase({ dataRoot: root.path });
    try {
      handle.client
        .prepare(
          `INSERT INTO companies
           (id, slug, name, aliases_json, enabled, created_at, updated_at)
           VALUES ('company-1', 'example', '示例公司', '[]', 1, 1, 1)`,
        )
        .run();
      handle.client
        .prepare(
          `INSERT INTO source_channels
           (id, company_id, channel, slug, enabled, created_at, updated_at)
           VALUES ('channel-1', 'company-1', 'social', 'example-social', 1, 1, 1)`,
        )
        .run();
      handle.client
        .prepare(
          `INSERT INTO job_sources
           (id, company_id, channel_id, slug, adapter_key, base_url, config_json,
            sync_policy_version, sync_policy_json, enabled, support_status, health_status,
            consecutive_failures, created_at, updated_at)
           VALUES ('source-1', 'company-1', 'channel-1', 'example-social', 'example.social',
            'https://jobs.example.com', '{}', 'v1', '{}', 1, 'supported', 'healthy', 0, 1, 1)`,
        )
        .run();
      handle.client
        .prepare(
          `INSERT INTO sync_runs
           (id, source_id, trigger, status, coverage, adapter_version, normalizer_version,
            sync_policy_version, source_config_hash, stats_json, started_at, finished_at)
           VALUES ('sync-1', 'source-1', 'manual', 'succeeded', 'complete', 'v1', 'v1',
            'v1', 'hash', '{}', 1000, 2000)`,
        )
        .run();
      handle.client
        .prepare(
          `INSERT INTO jobs
           (id, company_id, source_id, external_job_id, title, locations_json, description,
            detail_url, apply_url, status, missing_count, content_hash, first_seen_at,
            last_seen_at, created_at, updated_at)
           VALUES ('job-1', 'company-1', 'source-1', 'external-1', 'Agent 工程师', '[]',
            '职责描述', 'https://jobs.example.com/1', 'https://jobs.example.com/1/apply',
            'active', 0, 'job-hash', 1, 1, 1, 1)`,
        )
        .run();
      handle.client
        .prepare(
          `INSERT INTO tasks
           (id, task_type, payload_json, status, priority, idempotency_key, attempt_count,
            max_attempts, available_at, created_at)
           VALUES ('task-1', 'source.sync', '{}', 'pending', 0, 'pending-1', 0, 3, 1, 1),
                  ('task-2', 'source.sync', '{}', 'failed', 0, 'failed-1', 3, 3, 1, 1)`,
        )
        .run();

      expect(new SqliteDashboardReadModel(handle.client).snapshot()).toEqual({
        activeJobs: 1,
        currentMatches: 0,
        sources: { healthy: 1, total: 1 },
        tasks: { pending: 1, failed: 1 },
        latestSync: {
          sourceName: '示例公司',
          status: 'succeeded',
          finishedAt: new Date(2000).toISOString(),
        },
        nextAction: {
          type: 'create_profile',
          message: '建立简历画像是第一步',
          href: '/profile',
        },
        highlightJobs: [],
      });
    } finally {
      handle.close();
      await root.cleanup();
    }
  });
});
