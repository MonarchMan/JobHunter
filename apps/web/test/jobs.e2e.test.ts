import { resolveAppConfig, resolveBootstrapConfig } from '@jobhunter/common/config/index';
import { openSqliteDatabase } from '@jobhunter/common/persistence/connection';
import { createTemporaryDataRoot } from '@jobhunter/common/testing';
import { makeCandidateProfile } from '@jobhunter/user/testing';
import { describe, expect, it } from 'vitest';
import { createLocalWebContainer } from '../src/server/container.js';
import { nextPageHref, parseWebJobQuery } from '../src/server/job-query.js';
import { seedPlatformJobs } from './fixtures/platform-jobs.js';

/** 构造测试输入或执行断言的辅助逻辑。 */
function seedJobs(dataRoot: string): void {
  const database = openSqliteDatabase({ dataRoot });
  const profile = JSON.stringify(makeCandidateProfile({ targetRoles: ['研发'] }));
  try {
    seedPlatformJobs(database);
    // 同名平台公司先于官网写入，确保查询不依赖全库 LIMIT 1 的偶然顺序。
    database.client
      .prepare(
        "UPDATE companies SET name='腾讯' WHERE id IN (SELECT company_id FROM company_external_identities)",
      )
      .run();
    database.client
      .prepare(
        `INSERT INTO companies
         (id, slug, name, aliases_json, enabled, created_at, updated_at)
         VALUES ('018f0000-0000-7000-8000-000000000101', 'tencent', '腾讯', '["鹅厂"]', 1, 1, 1)`,
      )
      .run();
    database.client
      .prepare(
        `INSERT INTO source_channels
         (id, company_id, channel, slug, enabled, created_at, updated_at)
         VALUES ('018f0000-0000-7000-8200-000000010103',
                 '018f0000-0000-7000-8000-000000000101', 'social',
                 'tencent-social', 1, 1, 1)`,
      )
      .run();
    database.client
      .prepare(
        `INSERT INTO job_sources
         (id, company_id, channel_id, slug, adapter_key, base_url, config_json,
          sync_policy_version, sync_policy_json, enabled, support_status, health_status,
          consecutive_failures, created_at, updated_at)
         VALUES ('018f0000-0000-7000-8000-000000000201',
          '018f0000-0000-7000-8000-000000000101',
          '018f0000-0000-7000-8200-000000010103', 'tencent-social', 'tencent.social',
          'https://careers.tencent.com', '{}', 'v1', '{}', 1, 'supported',
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
        `WITH scan_input (id, source_id, trigger, status, coverage, stats_json, started_at, finished_at) AS (VALUES ('018f0000-0000-7000-8000-000000000501', '018f0000-0000-7000-8000-000000000201', 'manual', 'succeeded', 'complete', '{}', 1, 2))
INSERT INTO tasks(id,task_type,private_state,public_state,status,idempotency_key,attempt_count,max_attempts,available_at,created_at,started_at,finished_at,error_category,error_summary) SELECT id,'source.scan',json_object('sourceId',source_id,'trigger',trigger),json_object('status',status,'coverage',coverage,'stats',json(scan_input.stats_json),'coverageEvidence',json('{}')),CASE WHEN status='partial' THEN 'succeeded' ELSE status END,'source.scan:'||id,1,1,started_at,started_at,started_at,scan_input.finished_at,NULL,NULL FROM scan_input`,
      )
      .run();
    database.client
      .prepare(
        `UPDATE jobs SET content_id='018f0000-0000-7000-8000-000000000503',content_hash='revision-hash',source_payload_hash=?,source_url='https://careers.tencent.com/job/1'  WHERE jobs.id='018f0000-0000-7000-8000-000000000401'`,
      )
      .run('d'.repeat(64));
    database.client
      .prepare(
        `INSERT INTO candidate_profiles (id, name, created_at, updated_at)
         VALUES ('018f0000-0000-7000-8000-000000000601', '测试画像', 1, 1)`,
      )
      .run();
    database.client
      .prepare(
        `WITH profile_input (id, profile_id, version_no, profile_json, content_hash, is_current, created_at) AS (VALUES ('018f0000-0000-7000-8000-000000000602', '018f0000-0000-7000-8000-000000000601', 1, ?, ?, 1, 1))
INSERT INTO profile_versions (id,profile_id,version_no,content_hash,is_current,created_at,matching_constraints_json,basic_info_json,target_roles_json,intended_roles_json,preferences_json,education_json,work_experience_json,projects_json,works_json,competitions_json,certificates_json,languages_json,professional_skills,self_evaluation,skills_json,domains_json,years_of_experience,management_experience)
SELECT id,profile_id,version_no,content_hash,is_current,created_at,COALESCE(json_extract(profile_json,'$.matchingConstraints'),'{}'),COALESCE(json_extract(profile_json,'$.basicInfo'),'{}'),COALESCE(json_extract(profile_json,'$.targetRoles'),'[]'),COALESCE(json_extract(profile_json,'$.intendedRoles'),'[]'),COALESCE(json_extract(profile_json,'$.preferences'),'{}'),COALESCE(json_extract(profile_json,'$.education'),'[]'),COALESCE(json_extract(profile_json,'$.workExperience'),'[]'),COALESCE(json_extract(profile_json,'$.projects'),'[]'),COALESCE(json_extract(profile_json,'$.works'),'[]'),COALESCE(json_extract(profile_json,'$.competitions'),'[]'),COALESCE(json_extract(profile_json,'$.certificates'),'[]'),COALESCE(json_extract(profile_json,'$.languages'),'[]'),json_extract(profile_json,'$.professionalSkills'),json_extract(profile_json,'$.selfEvaluation'),COALESCE(json_extract(profile_json,'$.skills'),'[]'),COALESCE(json_extract(profile_json,'$.domains'),'[]'),json_extract(profile_json,'$.yearsOfExperience'),json_extract(profile_json,'$.managementExperience') FROM profile_input`,
      )
      .run(profile, 'e'.repeat(64));

    database.client
      .prepare(
        `INSERT INTO job_metadata(id,job_id,name,value,created_at,updated_at) VALUES ( '018f0000-0000-7000-8000-000000000604',(SELECT id FROM jobs WHERE content_id='018f0000-0000-7000-8000-000000000503'),'match_result',json_object('content_id','018f0000-0000-7000-8000-000000000503','profile_version_id','018f0000-0000-7000-8000-000000000602','enrichment_id',NULL,'rules_hash','fixture','filter_status','eligible','total_score',78,'input_hash','match-hash','components',json((SELECT json_group_array(json_object('dimension',json_extract(c.value,'$.dimension'),'score',json_extract(c.value,'$.score'),'max_score',json_extract(c.value,'$.maximumScore'))) FROM json_each('[{"dimension":"skills","score":28,"maximumScore":35,"matchedEvidence":[{"source":"profile","path":"/skills/0","summary":"具备 Agent 开发经验"}],"missingEvidence":["生产级评测经验"],"uncertainties":[]}]') c WHERE json_extract(c.value,'$.dimension')!='model')),'risk_results',json((SELECT json_group_array(json_extract(r.value,'$.ruleId')) FROM json_each('[{"ruleId":"location","status":"pass","evidence":[{"source":"preference","path":"/preferences/locations","summary":"接受北京"}],"explanation":"地点符合偏好"}]') r WHERE json_extract(r.value,'$.status')='fail')),'unknown_rules',json((SELECT json_group_array(json_extract(r.value,'$.ruleId')) FROM json_each('[{"ruleId":"location","status":"pass","evidence":[{"source":"preference","path":"/preferences/locations","summary":"接受北京"}],"explanation":"地点符合偏好"}]') r WHERE json_extract(r.value,'$.status')='unknown')),'model',NULL),3,3 )`,
      )
      .run();
  } finally {
    database.close();
  }
}

describe('Web job listing', () => {
  it('returns and sorts source dates independently of local content and observation times', async () => {
    const root = await createTemporaryDataRoot('jobhunter-web-job-dates-');
    try {
      seedJobs(root.path);
      const database = openSqliteDatabase({ dataRoot: root.path });
      const bootstrap = resolveBootstrapConfig({
        cli: { dataRoot: root.path },
        environment: {},
        cwd: root.path,
      });
      const container = createLocalWebContainer(resolveAppConfig({ bootstrap, environment: {} }));
      try {
        // 1、来源日期决定 published_desc 顺序，不能受本地写入时间影响。
        database.client
          .prepare("UPDATE jobs SET published_at = 100 WHERE external_job_id = 'web-job-1'")
          .run();
        database.client
          .prepare("UPDATE jobs SET published_at = 200 WHERE external_job_id = 'web-job-2'")
          .run();
        const query = parseWebJobQuery({});
        expect(query.sort).toBe('published_desc');
        expect(container.services.settings.get().jobListPreferences.defaultSort).toBe(
          'published_desc',
        );
        expect(container.services.webJobs.list(query).items).toMatchObject([
          {
            title: '大模型应用工程师',
            publishedAt: new Date(200).toISOString(),
            updatedAt: new Date(2).toISOString(),
          },
          {
            title: 'Agent 开发工程师',
            publishedAt: new Date(100).toISOString(),
            updatedAt: new Date(3).toISOString(),
          },
        ]);
        // 1.a、显式排序仍优先，不能被默认发布时间顺序覆盖。
        expect(
          container.services.webJobs.list(parseWebJobQuery({ sort: 'updated_desc' })).items[0]
            ?.title,
        ).toBe('Agent 开发工程师');
        // 2、来源更新日期后读取新值；缺失值保持 null 并排后，不用本地日期补齐。
        database.client
          .prepare("UPDATE jobs SET published_at = 300 WHERE external_job_id = 'web-job-1'")
          .run();
        database.client
          .prepare("UPDATE jobs SET published_at = NULL WHERE external_job_id = 'web-job-2'")
          .run();
        expect(container.services.webJobs.list(query).items).toMatchObject([
          { title: 'Agent 开发工程师', publishedAt: new Date(300).toISOString() },
          { title: '大模型应用工程师', publishedAt: null },
        ]);
        // 2.a、合法的零时间也排在未知之前，并验证跨页仍按新到旧连续。
        database.client
          .prepare("UPDATE jobs SET published_at = 0 WHERE external_job_id = 'web-job-2'")
          .run();
        database.client
          .prepare("UPDATE jobs SET published_at = NULL WHERE external_job_id = 'web-job-1'")
          .run();
        const firstPage = container.services.webJobs.list(parseWebJobQuery({ limit: '1' }));
        expect(firstPage.items[0]).toMatchObject({
          title: '大模型应用工程师',
          publishedAt: new Date(0).toISOString(),
        });
        expect(
          container.services.webJobs.list(parseWebJobQuery({ limit: '1', page: '2' })).items[0],
        ).toMatchObject({ title: 'Agent 开发工程师', publishedAt: null });
        expect(
          container.services.webJobs
            .list(parseWebJobQuery({ source: 'platform' }))
            .items.every((item) => item.publishedAt === null),
        ).toBe(true);
      } finally {
        container.close();
        database.close();
      }
    } finally {
      await root.cleanup();
    }
  });

  it('keeps filters in URLs and uses stable forward cursors with closed hidden by default', async () => {
    const root = await createTemporaryDataRoot('jobhunter-web-jobs-');
    try {
      seedJobs(root.path);
      const bootstrap = resolveBootstrapConfig({
        cli: { dataRoot: root.path },
        environment: {},
        cwd: root.path,
      });
      const container = createLocalWebContainer(resolveAppConfig({ bootstrap, environment: {} }));
      try {
        const query = parseWebJobQuery({ company: '腾讯', limit: '1' });
        const first = container.services.webJobs.list(query);
        expect(first.items).toHaveLength(1);
        expect(first.items[0]).toMatchObject({
          title: 'Agent 开发工程师',
          status: 'active',
          updatedAt: new Date(3).toISOString(),
        });
        expect(first.nextCursor).toBeTruthy();

        const href = nextPageHref({ company: '腾讯', limit: '1' }, first.nextCursor ?? '');
        expect(href).toContain('company=%E8%85%BE%E8%AE%AF');
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
        // 1、未知招聘类别的平台职位默认可见，官网默认视图不混入平台。
        expect(container.services.webJobs.list(parseWebJobQuery({})).page.total).toBe(2);
        const allPlatforms = container.services.webJobs.list(
          parseWebJobQuery({ source: 'platform' }),
        );
        expect(allPlatforms.page.total).toBe(3);
        expect(allPlatforms.items.every((item) => item.recruitmentCategory === null)).toBe(true);
        // 2、provider 与关键词筛选共同作用于计数和数字分页。
        const platformFilter = {
          source: 'platform',
          provider: 'boss',
          company: '腾讯',
          q: '平台工程师',
          limit: '1',
        };
        const platformFirst = container.services.webJobs.list(parseWebJobQuery(platformFilter));
        const platformSecond = container.services.webJobs.list(
          parseWebJobQuery({ ...platformFilter, page: '2' }),
        );
        expect(platformFirst.page.total).toBe(2);
        expect(platformSecond.page.total).toBe(2);
        expect(platformSecond.items[0]?.id).not.toBe(platformFirst.items[0]?.id);
        expect(platformFirst.items[0]?.title).toContain('BOSS');
        expect(platformSecond.items[0]?.title).toContain('BOSS');
        expect(
          container.services.webJobs.list(
            parseWebJobQuery({ source: 'platform', provider: 'zhilian', company: '腾讯' }),
          ).page.total,
        ).toBe(1);
        expect(
          container.services.webJobs.list(parseWebJobQuery({ source: 'platform', company: '腾讯' }))
            .page.total,
        ).toBe(3);
        expect(
          container.services.webJobs.list(
            parseWebJobQuery({ source: 'platform', category: 'internship' }),
          ).page.total,
        ).toBe(0);

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
              components: [
                { dimension: 'skills', score: 28, maximumScore: 35, matchedEvidence: [] },
              ],
              ruleOutcomes: [],
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
    expect(() => parseWebJobQuery({ source: 'invalid' })).toThrow();
    expect(() => parseWebJobQuery({ source: 'platform', provider: 'invalid' })).toThrow();
  });
});
