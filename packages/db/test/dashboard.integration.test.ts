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
      // 1、同一职位存在多次修订时仍只展示一次；无修订、过期和关闭职位不误入精选。
      const now = Date.now();
      handle.client
        .prepare('UPDATE jobs SET first_seen_at=?, updated_at=? WHERE id=?')
        .run(now, now, 'job-1');
      const insertRevision = handle.client.prepare(`INSERT INTO job_revisions
        (id,job_id,revision_no,content_hash,normalizer_version,source_payload_hash,source_url,snapshot_json,change_set_json,created_at)
        VALUES(?,'job-1',?,?,'v1',?,'https://jobs.example.com/1','{}','[]',?)`);
      insertRevision.run('revision-1', 1, 'hash-1', 'a'.repeat(64), now - 1000);
      insertRevision.run('revision-2', 2, 'hash-2', 'b'.repeat(64), now);
      expect(new SqliteDashboardReadModel(handle.client).snapshot().highlightJobs).toMatchObject([
        { id: 'job-1', title: 'Agent 工程师', score: null, isNew: true },
      ]);
      expect(new SqliteDashboardReadModel(handle.client).snapshot().highlightJobs).toHaveLength(1);
      // 2、旧修订高分不能进入精选，新修订被排除时同样不显示。
      handle.client.exec(`INSERT INTO candidate_profiles VALUES('profile-1','test',1,1);
        INSERT INTO profile_versions(id,profile_id,version_no,extracted_json,effective_json,content_hash,is_current,created_at)
        VALUES('profile-version-1','profile-1',1,'{}','{}','profile-hash',1,1);
        INSERT INTO match_rulesets VALUES('rules-1','v1','{}','rules-hash',1,1);
        INSERT INTO match_results(id,profile_version_id,job_revision_id,ruleset_id,filter_status,total_score,components_json,risks_json,input_hash,created_at)
        VALUES('match-1','profile-version-1','revision-1','rules-1','eligible',95,'[]','[]','match-hash-1',1),
        ('match-2','profile-version-1','revision-2','rules-1','eligible',40,'[]','[]','match-hash-2',2)`);
      expect(new SqliteDashboardReadModel(handle.client).snapshot().highlightJobs[0]?.score).toBe(
        40,
      );
      handle.client.exec("UPDATE match_results SET filter_status='excluded' WHERE id='match-2'");
      expect(new SqliteDashboardReadModel(handle.client).snapshot().highlightJobs).toEqual([]);
      handle.client.exec("UPDATE match_results SET filter_status='eligible' WHERE id='match-2'");
      handle.client.exec("UPDATE jobs SET status='closed' WHERE id='job-1'");
      expect(new SqliteDashboardReadModel(handle.client).snapshot().highlightJobs).toEqual([]);
    } finally {
      handle.close();
      await root.cleanup();
    }
  });
});
