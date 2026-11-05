import { createTemporaryDataRoot } from '@jobhunter/common/testing';
import { describe, expect, it } from 'vitest';
import { openSqliteDatabase } from '@jobhunter/common/persistence/connection';
import { createDashboardReadModel } from '../src/server/dashboard/runtime.js';

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
          `WITH scan_fixture(id, source_id, trigger, status, coverage, adapter_version, normalizer_version,
            sync_policy_version, source_config_hash, stats_json, started_at, finished_at) AS (VALUES ('sync-1', 'source-1', 'manual', 'succeeded', 'complete', 'v1', 'v1',
            'v1', 'hash', '{}', 1000, 2000)) INSERT INTO tasks(id,task_type,private_state,public_state,status,idempotency_key,attempt_count,max_attempts,available_at,created_at,started_at,finished_at,error_category,error_summary) SELECT id,'source.scan',json_object('sourceId',source_id,'trigger',trigger),json_object('status',status,'coverage',coverage,'stats',json(scan_fixture.stats_json),'coverageEvidence',json('{}')),CASE WHEN status='partial' THEN 'succeeded' ELSE status END,'source.scan:'||id,1,1,started_at,started_at,started_at,scan_fixture.finished_at,NULL,NULL FROM scan_fixture`,
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
           (id, task_type, private_state, status, priority, idempotency_key, attempt_count,
            max_attempts, available_at, created_at)
           VALUES ('task-1', 'source.sync', '{}', 'pending', 0, 'pending-1', 0, 3, 1, 1),
                  ('task-2', 'source.sync', '{}', 'failed', 0, 'failed-1', 3, 3, 1, 1)`,
        )
        .run();

      expect(createDashboardReadModel(handle.client).snapshot()).toEqual({
        hasProfile: false,
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
      // 1、更新后只保留当前内容；无内容、过期和关闭职位不误入精选。
      const now = Date.now();
      handle.client
        .prepare('UPDATE jobs SET first_seen_at=?, updated_at=? WHERE id=?')
        .run(now, now, 'job-1');
      const insertRevision = handle.client.prepare(
        `UPDATE jobs SET content_id=d.id,content_hash=d.content_hash,source_payload_hash=d.source_payload_hash,source_url=d.source_url FROM (SELECT ? AS id,'job-1' AS job_id,? AS revision_no,? AS content_hash,'v1' AS normalizer_version,? AS source_payload_hash,'https://jobs.example.com/1' AS source_url,'{}' AS snapshot_json,'[]' AS change_set_json,? AS created_at) d WHERE jobs.id=d.job_id`,
      );
      insertRevision.run('revision-1', 1, 'hash-1', 'a'.repeat(64), now - 1000);
      insertRevision.run('revision-2', 2, 'hash-2', 'b'.repeat(64), now);
      expect(createDashboardReadModel(handle.client).snapshot().highlightJobs).toMatchObject([
        { id: 'job-1', title: 'Agent 工程师', score: null, isNew: true },
      ]);
      expect(createDashboardReadModel(handle.client).snapshot().highlightJobs).toHaveLength(1);
      expect(handle.client.prepare(`SELECT count(*) FROM jobs`).pluck().get()).toBe(1);
      // 2、当前内容被排除时不显示，旧内容结果清理由同步集成测试覆盖。
      handle.client.exec(`INSERT INTO candidate_profiles VALUES('profile-1','test',1,1);
        WITH profile_fixture (id,profile_id,version_no,extracted_json,effective_json,content_hash,is_current,created_at) AS (VALUES ('profile-version-1','profile-1',1,'{}','{}','profile-hash',1,1))
INSERT INTO profile_versions (id,profile_id,version_no,content_hash,is_current,created_at,matching_constraints_json,basic_info_json,target_roles_json,intended_roles_json,preferences_json,education_json,work_experience_json,projects_json,works_json,competitions_json,certificates_json,languages_json,professional_skills,self_evaluation,skills_json,domains_json,years_of_experience,management_experience)
SELECT id,profile_id,version_no,content_hash,is_current,created_at,COALESCE(json_extract(effective_json,'$.matchingConstraints'),'{}'),COALESCE(json_extract(effective_json,'$.basicInfo'),'{}'),COALESCE(json_extract(effective_json,'$.targetRoles'),'[]'),COALESCE(json_extract(effective_json,'$.intendedRoles'),'[]'),COALESCE(json_extract(effective_json,'$.preferences'),'{}'),COALESCE(json_extract(effective_json,'$.education'),'[]'),COALESCE(json_extract(effective_json,'$.workExperience'),'[]'),COALESCE(json_extract(effective_json,'$.projects'),'[]'),COALESCE(json_extract(effective_json,'$.works'),'[]'),COALESCE(json_extract(effective_json,'$.competitions'),'[]'),COALESCE(json_extract(effective_json,'$.certificates'),'[]'),COALESCE(json_extract(effective_json,'$.languages'),'[]'),json_extract(effective_json,'$.professionalSkills'),json_extract(effective_json,'$.selfEvaluation'),COALESCE(json_extract(effective_json,'$.skills'),'[]'),COALESCE(json_extract(effective_json,'$.domains'),'[]'),json_extract(effective_json,'$.yearsOfExperience'),json_extract(effective_json,'$.managementExperience') FROM profile_fixture;
        SELECT * FROM (SELECT 'rules-1' AS id,'{}' AS definition_json,'rules-hash' AS definition_hash,1 AS active,1 AS created_at) d;
        INSERT INTO job_metadata(id,job_id,name,value,created_at,updated_at) SELECT d.id,(SELECT id FROM jobs WHERE content_id=d.job_revision_id),'match_result',json_object('content_id',d.job_revision_id,'profile_version_id',d.profile_version_id,'enrichment_id',NULL,'rules_hash','fixture','filter_status',d.filter_status,'total_score',d.total_score,'input_hash',d.input_hash,'components',json((SELECT json_group_array(json_object('dimension',json_extract(c.value,'$.dimension'),'score',json_extract(c.value,'$.score'),'max_score',json_extract(c.value,'$.maximumScore'))) FROM json_each(d.components_json) c WHERE json_extract(c.value,'$.dimension')!='model')),'risk_results',json((SELECT json_group_array(json_extract(r.value,'$.ruleId')) FROM json_each(d.risks_json) r WHERE json_extract(r.value,'$.status')='fail')),'unknown_rules',json((SELECT json_group_array(json_extract(r.value,'$.ruleId')) FROM json_each(d.risks_json) r WHERE json_extract(r.value,'$.status')='unknown')),'model',NULL),d.created_at,d.created_at FROM (SELECT 'match-2' AS id,'profile-version-1' AS profile_version_id,'revision-2' AS job_revision_id,'rules-1' AS ruleset_id,'eligible' AS filter_status,40 AS total_score,'[]' AS components_json,'[]' AS risks_json,'match-hash-2' AS input_hash,2 AS created_at) d`);
      expect(createDashboardReadModel(handle.client).snapshot().highlightJobs[0]?.score).toBe(40);
      handle.client.exec(
        `UPDATE job_metadata SET value=json_set(value,'$.filter_status','excluded') WHERE id='match-2'`,
      );
      expect(createDashboardReadModel(handle.client).snapshot().highlightJobs).toEqual([]);
      handle.client.exec(
        `UPDATE job_metadata SET value=json_set(value,'$.filter_status','eligible') WHERE id='match-2'`,
      );
      handle.client.exec("UPDATE jobs SET status='closed' WHERE id='job-1'");
      expect(createDashboardReadModel(handle.client).snapshot().highlightJobs).toEqual([]);
    } finally {
      handle.close();
      await root.cleanup();
    }
  });
});
