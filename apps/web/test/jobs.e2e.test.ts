import { resolveAppConfig, resolveBootstrapConfig } from '@jobhunter/application';
import { openSqliteDatabase } from '@jobhunter/db';
import { createTemporaryDataRoot } from '@jobhunter/testkit';
import { describe, expect, it } from 'vitest';
import { createLocalWebContainer } from '../src/server/container.js';
import { nextPageHref, parseWebJobQuery } from '../src/server/job-query.js';

function seedJobs(dataRoot: string): void {
  const database = openSqliteDatabase({ dataRoot });
  try {
    database.client
      .prepare(
        `INSERT INTO companies
         (id, slug, name, aliases_json, enabled, created_at, updated_at)
         VALUES ('018f0000-0000-7000-8000-000000000101', 'tencent', '腾讯', '["鹅厂"]', 1, 1, 1)`,
      )
      .run();
    database.client
      .prepare(
        `INSERT INTO job_sources
         (id, company_id, slug, adapter_key, recruitment_type, base_url, config_json,
          sync_policy_version, sync_policy_json, enabled, support_status, health_status,
          consecutive_failures, created_at, updated_at)
         VALUES ('018f0000-0000-7000-8000-000000000201',
          '018f0000-0000-7000-8000-000000000101', 'tencent-social', 'tencent.social',
          'social', 'https://careers.tencent.com', '{}', 'v1', '{}', 1, 'supported',
          'healthy', 0, 1, 1)`,
      )
      .run();
    const insert = database.client.prepare(
      `INSERT INTO jobs
       (id, company_id, source_id, external_job_id, title, department, job_family,
        recruitment_category, locations_json, description, detail_url, apply_url, status, missing_count,
        content_hash, first_seen_at, last_seen_at, created_at, updated_at)
       VALUES (?, '018f0000-0000-7000-8000-000000000101',
        '018f0000-0000-7000-8000-000000000201', ?, ?, '大模型平台', '研发', 'internship', ?, ?, ?, ?,
        ?, 0, ?, 1, 1, 1, ?)`,
    );
    insert.run(
      '018f0000-0000-7000-8000-000000000401',
      'web-job-1',
      'Agent 开发工程师',
      '["北京"]',
      '建设 Agent 平台',
      'https://careers.tencent.com/job/1',
      'https://careers.tencent.com/apply/1',
      'active',
      'hash-1',
      3,
    );
    insert.run(
      '018f0000-0000-7000-8000-000000000402',
      'web-job-2',
      '大模型应用工程师',
      '["深圳"]',
      '开发大模型应用',
      'https://careers.tencent.com/job/2',
      'https://careers.tencent.com/apply/2',
      'stale',
      'hash-2',
      2,
    );
    insert.run(
      '018f0000-0000-7000-8000-000000000403',
      'web-job-3',
      '历史算法工程师',
      '["上海"]',
      '职位已关闭',
      'https://careers.tencent.com/job/3',
      'https://careers.tencent.com/apply/3',
      'closed',
      'hash-3',
      1,
    );
    database.client
      .prepare(
        `INSERT INTO sync_runs
         (id, source_id, trigger, status, coverage, adapter_version, normalizer_version,
          sync_policy_version, source_config_hash, stats_json, started_at, finished_at)
         VALUES ('018f0000-0000-7000-8000-000000000501',
          '018f0000-0000-7000-8000-000000000201', 'manual', 'succeeded', 'complete',
          'v1', 'v1', 'v1', 'source-hash', '{}', 1, 2)`,
      )
      .run();
    database.client
      .prepare(
        `INSERT INTO raw_job_records
         (id, source_id, first_sync_run_id, external_job_id, identity_key, source_url,
          content_hash, payload_json, captured_at)
         VALUES ('018f0000-0000-7000-8000-000000000502',
          '018f0000-0000-7000-8000-000000000201',
          '018f0000-0000-7000-8000-000000000501', 'web-job-1', 'web-job-1',
          'https://careers.tencent.com/job/1', 'raw-hash', '{}', 1)`,
      )
      .run();
    database.client
      .prepare(
        `INSERT INTO job_revisions
         (id, job_id, revision_no, content_hash, normalizer_version, snapshot_json,
          change_set_json, raw_record_id, created_at)
         VALUES ('018f0000-0000-7000-8000-000000000503',
          '018f0000-0000-7000-8000-000000000401', 1, 'revision-hash', 'v1', '{}',
          '[]',
          '018f0000-0000-7000-8000-000000000502', 2)`,
      )
      .run();
    database.client
      .prepare(
        `INSERT INTO candidate_profiles (id, name, created_at, updated_at)
         VALUES ('018f0000-0000-7000-8000-000000000601', '测试画像', 1, 1)`,
      )
      .run();
    database.client
      .prepare(
        `INSERT INTO profile_versions
         (id, profile_id, version_no, extracted_json, effective_json, locked_paths_json,
          content_hash, is_current, created_at)
         VALUES ('018f0000-0000-7000-8000-000000000602',
          '018f0000-0000-7000-8000-000000000601', 1, '{}', '{}', '[]',
          'profile-hash', 1, 1)`,
      )
      .run();
    database.client
      .prepare(
        `INSERT INTO match_rulesets
         (id, version, definition_json, definition_hash, active, created_at)
         VALUES ('018f0000-0000-7000-8000-000000000603', 'web-v1',
          '{"version":"web-v1","weights":{"skills":35,"experience":25,"role":15,"industry":10,"location":15}}',
          'ruleset-hash', 1, 1)`,
      )
      .run();
    database.client
      .prepare(
        `INSERT INTO match_results
         (id, profile_version_id, job_revision_id, ruleset_id, filter_status, total_score,
          components_json, risks_json, input_hash, created_at)
         VALUES ('018f0000-0000-7000-8000-000000000604',
          '018f0000-0000-7000-8000-000000000602',
          '018f0000-0000-7000-8000-000000000503',
          '018f0000-0000-7000-8000-000000000603', 'eligible', 78,
          '[{"dimension":"skills","score":28,"maximumScore":35,"matchedEvidence":[{"source":"profile","path":"/skills/0","summary":"具备 Agent 开发经验"}],"missingEvidence":["生产级评测经验"],"uncertainties":[]}]',
          '[{"ruleId":"location","status":"pass","evidence":[{"source":"preference","path":"/preferences/locations","summary":"接受北京"}],"explanation":"地点符合偏好"}]',
          'match-hash', 3)`,
      )
      .run();
  } finally {
    database.close();
  }
}

describe('Web job listing', () => {
  it('keeps filters in URLs and uses stable forward cursors with closed hidden by default', async () => {
    const root = await createTemporaryDataRoot('jobhunter-web-jobs-');
    try {
      seedJobs(root.path);
      const bootstrap = resolveBootstrapConfig({
        cli: { dataRoot: root.path },
        environment: {},
        cwd: root.path,
      });
      const container = createLocalWebContainer(
        resolveAppConfig({ bootstrap, environment: {}, file: {} }),
      );
      try {
        const query = parseWebJobQuery({ company: '鹅厂', limit: '1' });
        const first = container.services.webJobs.list(query);
        expect(first.items).toHaveLength(1);
        expect(first.items[0]).toMatchObject({
          title: 'Agent 开发工程师',
          status: 'active',
          updatedAt: new Date(3).toISOString(),
        });
        expect(first.nextCursor).toBeTruthy();

        const href = nextPageHref({ company: '鹅厂', limit: '1' }, first.nextCursor ?? '');
        expect(href).toContain('company=%E9%B9%85%E5%8E%82');
        const secondQuery = parseWebJobQuery(
          Object.fromEntries(new URL(`http://localhost${href}`).searchParams.entries()),
        );
        const second = container.services.webJobs.list(secondQuery);
        expect(second.items).toMatchObject([{ status: 'stale', locations: ['深圳'] }]);
        expect([...first.items, ...second.items]).not.toContainEqual(
          expect.objectContaining({ status: 'closed' }),
        );

        const closed = container.services.webJobs.list(parseWebJobQuery({ status: 'closed' }));
        expect(closed.items).toMatchObject([{ title: '历史算法工程师', status: 'closed' }]);
        const located = container.services.webJobs.list(parseWebJobQuery({ location: '北京' }));
        expect(located.items.map((item) => item.title)).toEqual(['Agent 开发工程师']);

        const detail = container.services.webJobDetails.get(
          '018f0000-0000-7000-8000-000000000401',
          '018f0000-0000-7000-8000-000000000602',
        );
        expect(detail).toMatchObject({
          detailUrl: 'https://careers.tencent.com/job/1',
          applyUrl: 'https://careers.tencent.com/apply/1',
          revisions: [{ revisionNumber: 1, changes: {} }],
          matches: [
            {
              totalScore: 78,
              components: [{ matchedEvidence: [{ summary: '具备 Agent 开发经验' }] }],
              ruleOutcomes: [{ explanation: '地点符合偏好' }],
              advice: { status: 'not_requested' },
            },
          ],
        });
      } finally {
        container.close();
      }
    } finally {
      await root.cleanup();
    }
  });

  it('rejects malformed score and status filters at the HTTP boundary parser', () => {
    expect(() => parseWebJobQuery({ minScore: 'NaN' })).toThrow();
    expect(() => parseWebJobQuery({ status: 'unknown' })).toThrow();
  });
});
