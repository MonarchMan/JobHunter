import { openSqliteDatabase } from '@jobhunter/common/persistence/connection';
import { canonicalJson } from '@jobhunter/common/domain';
import { parseCandidateProfile } from '@jobhunter/user/domain';
import { parseNormalizedJob } from '@jobhunter/recruitment/domain';
import { createTemporaryDataRoot } from '@jobhunter/common/testing';
import { createProductionTaskApplication } from '../src/task-runtime.js';
import path from 'node:path';
import { vi, describe, expect, it } from 'vitest';
import { runLocalCli, type CliIo } from '../src/index.js';

/** 构造测试输入或执行断言的辅助逻辑。 */
function memoryIo(): { readonly io: CliIo; readonly stdout: string[]; readonly stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: {
      stdout: { write: (value) => void stdout.push(value) },
      stderr: { write: (value) => void stderr.push(value) },
    },
  };
}

/** 构造测试输入或执行断言的辅助逻辑。 */
async function command(
  dataRoot: string,
  argv: readonly string[],
): Promise<{
  readonly exitCode: number;
  readonly body: Record<string, unknown>;
  readonly stderr: string;
}> {
  const output = memoryIo();
  const exitCode = await runLocalCli({
    argv: ['--json', '--data-root', dataRoot, ...argv],
    io: output.io,
    environment: {},
  });
  return {
    exitCode,
    body: JSON.parse(output.stdout.join('')) as Record<string, unknown>,
    stderr: output.stderr.join(''),
  };
}

const ids = {
  syncRun: '018f0000-0000-7000-8000-000000000601',
  raw: '018f0000-0000-7000-8000-000000000602',
  job: '018f0000-0000-7000-8000-000000000603',
  revision: '018f0000-0000-7000-8000-000000000604',
  profile: '018f0000-0000-7000-8000-000000000605',
  profileVersion: '018f0000-0000-7000-8000-000000000606',
} as const;

/** 构造测试输入或执行断言的辅助逻辑。 */
function seedMatchingInputs(dataRoot: string): void {
  const database = openSqliteDatabase({ dataRoot });
  const profile = parseCandidateProfile({
    targetRoles: ['Agent 开发'],
    preferences: {
      locations: ['北京'],
      companySizes: ['large'],
      employmentTypes: ['全职'],
      excludedTerms: [],
      remoteAccepted: null,
    },
    education: [],
    workExperience: [],
    projects: [],
    skills: [
      {
        name: 'TypeScript',
        level: 'proficient',
        evidence: [{ source: 'resume', quote: 'TypeScript Agent 项目' }],
      },
    ],
    domains: ['大模型应用'],
    yearsOfExperience: 3,
    managementExperience: false,
  });
  const normalized = parseNormalizedJob({
    companyId: '018f0000-0000-7000-8000-000000000101',
    sourceId: '018f0000-0000-7000-8000-000000000201',
    externalJobId: 'match-cli-job',
    title: 'Agent 开发工程师',
    department: '大模型平台',
    jobFamily: '研发',
    recruitmentCategory: 'social',
    locations: ['北京'],
    employmentType: '全职',
    experienceText: '3 年以上',
    educationText: '本科',
    description: '使用 TypeScript 开发 Agent 平台。',
    detailUrl: 'https://careers.tencent.com/job/agent',
    applyUrl: 'https://careers.tencent.com/apply/agent',
    publishedAt: 1_700_000_000_000,
  });
  try {
    database.client.exec(`
      WITH scan_fixture(id, source_id, trigger, status, coverage, adapter_version, normalizer_version,
         sync_policy_version, source_config_hash, stats_json, started_at) AS (VALUES ('${ids.syncRun}', '018f0000-0000-7000-8000-000000000201', 'manual', 'running',
         'unknown', 'fixture', 'fixture', 'v1', 'fixture', '{}', 1)) INSERT INTO tasks(id,task_type,private_state,public_state,status,idempotency_key,attempt_count,max_attempts,available_at,created_at,started_at,finished_at,error_category,error_summary) SELECT id,'source.scan',json_object('sourceId',source_id,'trigger',trigger),json_object('status',status,'coverage',coverage,'stats',json(scan_fixture.stats_json),'coverageEvidence',json('{}')),CASE WHEN status='partial' THEN 'succeeded' ELSE status END,'source.scan:'||id,1,1,started_at,started_at,started_at,NULL,NULL,NULL FROM scan_fixture;
      INSERT INTO jobs
        (id, company_id, source_id, external_job_id, title, department, job_family,
         recruitment_category,
         locations_json, employment_type, experience_text, education_text, description,
         detail_url, apply_url, published_at, status, missing_count, content_hash,
         first_seen_at, last_seen_at, created_at, updated_at)
      VALUES
        ('${ids.job}', '018f0000-0000-7000-8000-000000000101',
         '018f0000-0000-7000-8000-000000000201', 'match-cli-job', 'Agent 开发工程师',
         '大模型平台', '研发', 'social', '["北京"]', '全职', '3 年以上', '本科',
         '使用 TypeScript 开发 Agent 平台。', 'https://careers.tencent.com/job/agent',
         'https://careers.tencent.com/apply/agent', 1700000000000, 'active', 0,
         '${'b'.repeat(64)}', 1, 2, 1, 2);
      UPDATE jobs SET content_id=d.id,content_hash=d.content_hash,source_payload_hash=d.source_payload_hash,source_url=d.source_url FROM (SELECT '${ids.revision}' AS id, '${ids.job}' AS job_id, 1 AS revision_no, '${'b'.repeat(64)}' AS content_hash, 'fixture' AS normalizer_version,
         '${'a'.repeat(64)}' AS source_payload_hash, 'https://careers.tencent.com/job/agent' AS source_url,
         '${canonicalJson(normalized).replaceAll("'", "''")}' AS snapshot_json, '[]' AS change_set_json, 1 AS created_at) d WHERE jobs.id=d.job_id;
      INSERT INTO candidate_profiles (id, name, created_at, updated_at)
      VALUES ('${ids.profile}', '脱敏候选人', 1, 1);
      WITH profile_fixture (id, profile_id, version_no, resume_file_id, agent_run_id, extracted_json,
         effective_json, locked_paths_json, content_hash, is_current, created_at) AS (VALUES ('${ids.profileVersion}', '${ids.profile}', 1, NULL, NULL,
         '${canonicalJson(profile).replaceAll("'", "''")}',
         '${canonicalJson(profile).replaceAll("'", "''")}', '[]', '${'c'.repeat(64)}', 1, 1))
INSERT INTO profile_versions (id,profile_id,version_no,resume_file_id,agent_run_id,content_hash,is_current,created_at,matching_constraints_json,basic_info_json,target_roles_json,intended_roles_json,preferences_json,education_json,work_experience_json,projects_json,works_json,competitions_json,certificates_json,languages_json,professional_skills,self_evaluation,skills_json,domains_json,years_of_experience,management_experience)
SELECT id,profile_id,version_no,resume_file_id,agent_run_id,content_hash,is_current,created_at,COALESCE(json_extract(effective_json,'$.matchingConstraints'),'{}'),COALESCE(json_extract(effective_json,'$.basicInfo'),'{}'),COALESCE(json_extract(effective_json,'$.targetRoles'),'[]'),COALESCE(json_extract(effective_json,'$.intendedRoles'),'[]'),COALESCE(json_extract(effective_json,'$.preferences'),'{}'),COALESCE(json_extract(effective_json,'$.education'),'[]'),COALESCE(json_extract(effective_json,'$.workExperience'),'[]'),COALESCE(json_extract(effective_json,'$.projects'),'[]'),COALESCE(json_extract(effective_json,'$.works'),'[]'),COALESCE(json_extract(effective_json,'$.competitions'),'[]'),COALESCE(json_extract(effective_json,'$.certificates'),'[]'),COALESCE(json_extract(effective_json,'$.languages'),'[]'),json_extract(effective_json,'$.professionalSkills'),json_extract(effective_json,'$.selfEvaluation'),COALESCE(json_extract(effective_json,'$.skills'),'[]'),COALESCE(json_extract(effective_json,'$.domains'),'[]'),json_extract(effective_json,'$.yearsOfExperience'),json_extract(effective_json,'$.managementExperience') FROM profile_fixture;
    `);
  } finally {
    database.close();
  }
}

describe('match commands', () => {
  it('runs deterministic matching in the production worker and renders evidence details', async () => {
    const root = await createTemporaryDataRoot('jobhunter-cli-match-');
    const dataRoot = path.join(root.path, '中文 数据');
    try {
      expect((await command(dataRoot, ['init'])).exitCode).toBe(0);
      seedMatchingInputs(dataRoot);
      const queued = await command(dataRoot, ['match', 'score', ids.job]);
      expect(queued.exitCode).toBe(0);
      const taskId = (queued.body as { readonly data: { readonly task: { readonly id: string } } })
        .data.task.id;

      const worker = createProductionTaskApplication({ dataRoot, workerId: 'match-e2e' });
      try {
        for (let attempt = 0; attempt < 5; attempt += 1) {
          await worker.engine.runOnce('match.score-job');
          const current = await command(dataRoot, ['task', 'show', taskId]);
          const status = (
            current.body as { readonly data?: { readonly task?: { readonly status?: string } } }
          ).data?.task?.status;
          if (status === 'succeeded' || status === 'failed' || status === 'cancelled') break;
        }
      } finally {
        await worker.close();
      }
      expect((await command(dataRoot, ['task', 'show', taskId])).body).toMatchObject({
        data: { task: { status: 'succeeded' } },
      });

      const listed = await command(dataRoot, ['match', 'list', ids.profile]);
      expect(listed.exitCode).toBe(0);
      const item = (
        listed.body as {
          readonly data: {
            readonly items: readonly {
              readonly match: { readonly id: string; readonly totalScore: number };
            }[];
          };
        }
      ).data.items[0];
      expect(item?.match.totalScore).toBeGreaterThan(0);
      expect(item?.match.id).toBeTruthy();

      const shown = await command(dataRoot, ['match', 'show', item?.match.id ?? 'missing']);
      expect(shown.body).toMatchObject({
        ok: true,
        data: {
          job: { title: 'Agent 开发工程师' },
          advice: null,
        },
      });
      const shownMatch = (
        shown.body as {
          readonly data: {
            readonly match: { readonly components: unknown; readonly ruleOutcomes: unknown };
          };
        }
      ).data.match;
      expect(Array.isArray(shownMatch.components)).toBe(true);
      expect(Array.isArray(shownMatch.ruleOutcomes)).toBe(true);
      expect(shown.stderr).toBe('');

      const missing = await command(dataRoot, [
        'match',
        'show',
        '018f0000-0000-7000-8000-000000009999',
      ]);
      expect(missing.exitCode).toBe(3);
      expect(missing.body).toMatchObject({ ok: false, error: { code: 'MATCH_NOT_FOUND' } });
    } finally {
      await root.cleanup();
    }
  });
});

// 命令契约测试不启动网络执行器；中央服务真实生命周期由 embedded-tasks 覆盖。
vi.mock(import('@jobhunter/common/task-service'), async (original) => ({
  ...(await original()),
  ensureConfiguredTaskService: vi.fn(() => Promise.resolve()),
}));
