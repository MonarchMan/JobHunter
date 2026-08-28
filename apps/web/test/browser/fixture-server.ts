import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { makeCandidateProfile, FakeModel } from '@jobhunter/testkit';
import { openSqliteDatabase } from '@jobhunter/db';
import {
  parseNormalizedJob,
  type CandidateProfileData,
  type NormalizedJob,
} from '@jobhunter/domain';

const ids = {
  company: '018f0000-0000-7000-8000-000000000101',
  channel: '018f0000-0000-7000-8200-000000010102',
  source: '018f0000-0000-7000-8000-000000000201',
  syncRun: '018f0000-0000-7000-8000-000000000301',
  activeJob: '018f0000-0000-7000-8000-000000000401',
  staleJob: '018f0000-0000-7000-8000-000000000402',
  closedJob: '018f0000-0000-7000-8000-000000000403',
  activeRaw: '018f0000-0000-7000-8000-000000000501',
  staleRaw: '018f0000-0000-7000-8000-000000000502',
  activeRevision: '018f0000-0000-7000-8000-000000000503',
  staleRevision: '018f0000-0000-7000-8000-000000000504',
  profile: '018f0000-0000-7000-8000-000000000601',
  profileVersion: '018f0000-0000-7000-8000-000000000602',
  ruleset: '018f0000-0000-7000-8000-000000000603',
  match: '018f0000-0000-7000-8000-000000000604',
  task: '018f0000-0000-7000-8000-000000000701',
  agentRun: '018f0000-0000-7000-8000-000000000801',
  toolCall: '018f0000-0000-7000-8000-000000000802',
} as const;

const campusJobs = [
  parseNormalizedJob({
    sourceId: ids.source,
    companyId: ids.company,
    externalJobId: 'campus-agent-intern',
    title: '大模型应用实习生',
    department: '大模型平台',
    jobFamily: '研发',
    locations: ['深圳'],
    employmentType: '实习',
    experienceText: '在校生，有项目经验优先',
    educationText: '本科/硕士在读',
    description: '参与 Agent 应用开发、评测和工具调用链路建设。',
    detailUrl: 'https://careers.tencent.com/campus/agent-intern',
    applyUrl: 'https://careers.tencent.com/campus/agent-intern/apply',
    publishedAt: null,
  }),
  parseNormalizedJob({
    sourceId: ids.source,
    companyId: ids.company,
    externalJobId: 'campus-ai-product-intern',
    title: 'AI 产品实习生',
    department: 'AI 产品部',
    jobFamily: '产品',
    locations: ['北京', '北京市海淀区中关村软件园', '远程协作'],
    employmentType: '实习',
    experienceText: '在校生',
    educationText: '本科在读',
    description: '协助 AI 产品调研、需求分析与数据评估。',
    detailUrl: 'https://careers.tencent.com/campus/ai-product-intern',
    applyUrl: 'https://careers.tencent.com/campus/ai-product-intern/apply',
    publishedAt: null,
  }),
  parseNormalizedJob({
    sourceId: ids.source,
    companyId: ids.company,
    externalJobId: 'campus-legacy-intern',
    title: '历史算法实习生',
    department: '算法工程',
    jobFamily: '研发',
    locations: ['上海'],
    employmentType: '实习',
    experienceText: '在校生',
    educationText: '本科在读',
    description: '已关闭的校招实习职位。',
    detailUrl: 'https://careers.tencent.com/campus/legacy-intern',
    applyUrl: 'https://careers.tencent.com/campus/legacy-intern/apply',
    publishedAt: null,
  }),
] as const;

/** A deterministic adapter-like fixture keeps browser tests independent of public websites. */
class FakeAdapter {
  public readonly jobs = campusJobs;

  public normalize(job: NormalizedJob): NormalizedJob {
    return job;
  }
}

async function loadProfileFromFakeModel(): Promise<CandidateProfileData> {
  const model = new FakeModel<{ readonly resume: string }, CandidateProfileData>();
  const profile = makeCandidateProfile({
    targetRoles: ['大模型应用实习生', 'Agent 实习生'],
    preferences: {
      locations: ['深圳'],
      companySizes: ['large'],
      employmentTypes: ['实习'],
      excludedTerms: [],
      remoteAccepted: null,
    },
    education: [
      {
        institution: '某大学',
        degree: '本科在读',
        field: '计算机科学',
        startDate: null,
        endDate: null,
        evidence: [{ source: 'resume', quote: '某大学计算机科学本科在读' }],
      },
    ],
    skills: [
      {
        name: 'TypeScript',
        level: 'proficient',
        evidence: [{ source: 'resume', quote: 'TypeScript Agent 项目' }],
      },
    ],
    domains: ['大模型应用', 'Agent'],
    yearsOfExperience: null,
    managementExperience: null,
  });
  model.enqueue(profile);
  return model.invoke({ resume: '校招实习简历 fixture' });
}

function insertJob(
  database: ReturnType<typeof openSqliteDatabase>,
  job: NormalizedJob,
  input: {
    readonly id: string;
    readonly status: 'active' | 'stale' | 'closed';
    readonly rawId: string;
    readonly revisionId: string;
    readonly updatedAt: number;
  },
): void {
  database.client
    .prepare(
      `INSERT INTO jobs
       (id, company_id, source_id, external_job_id, title, department, job_family,
        locations_json, employment_type, recruitment_category, experience_text, education_text, description,
        detail_url, apply_url, status, missing_count, content_hash, first_seen_at,
        last_seen_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 1, ?, 1, ?)`,
    )
    .run(
      input.id,
      job.companyId,
      job.sourceId,
      job.externalJobId,
      job.title,
      job.department,
      job.jobFamily,
      JSON.stringify(job.locations),
      job.employmentType,
      'internship',
      job.experienceText,
      job.educationText,
      job.description,
      job.detailUrl,
      job.applyUrl,
      input.status,
      'a'.repeat(64),
      input.updatedAt,
      input.updatedAt,
    );
  database.client
    .prepare(
      `INSERT INTO raw_job_records
       (id, source_id, first_sync_run_id, external_job_id, identity_key, source_url,
        content_hash, payload_json, captured_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.rawId,
      job.sourceId,
      ids.syncRun,
      job.externalJobId,
      job.externalJobId,
      job.detailUrl,
      'b'.repeat(64),
      JSON.stringify(job),
      input.updatedAt,
    );
  database.client
    .prepare(
      `INSERT INTO job_revisions
       (id, job_id, revision_no, content_hash, normalizer_version, snapshot_json,
        change_set_json, raw_record_id, created_at)
       VALUES (?, ?, 1, ?, 'fake-campus-v1', ?, ?, ?, ?)`,
    )
    .run(
      input.revisionId,
      input.id,
      'c'.repeat(64),
      JSON.stringify(job),
      JSON.stringify([]),
      input.rawId,
      input.updatedAt,
    );
}

async function seedFixture(dataRoot: string): Promise<void> {
  const database = openSqliteDatabase({ dataRoot });
  const adapter = new FakeAdapter();
  const profile = await loadProfileFromFakeModel();
  try {
    database.client
      .prepare(
        `INSERT INTO companies (id, slug, name, aliases_json, enabled, created_at, updated_at)
         VALUES (?, 'tencent-campus', '腾讯校招', '[]', 1, 1, 1)`,
      )
      .run(ids.company);
    database.client
      .prepare(
        `INSERT INTO source_channels
         (id, company_id, channel, slug, enabled, created_at, updated_at)
         VALUES (?, ?, 'campus', 'tencent-campus', 1, 1, 1)`,
      )
      .run(ids.channel, ids.company);
    database.client
      .prepare(
        `INSERT INTO job_sources
         (id, company_id, channel_id, slug, adapter_key, recruitment_type, base_url, config_json,
          sync_policy_version, sync_policy_json, enabled, support_status, health_status,
          consecutive_failures, last_success_at, created_at, updated_at)
         VALUES (?, ?, ?, 'tencent-campus', 'fake.campus', 'campus',
          'https://careers.tencent.com/campus', '{}', 'fake-v1', '{}', 1,
          'supported', 'healthy', 0, 2, 1, 2)`,
      )
      .run(ids.source, ids.company, ids.channel);
    database.client
      .prepare(
        `INSERT INTO sync_runs
         (id, source_id, trigger, status, coverage, adapter_version, normalizer_version,
          sync_policy_version, source_config_hash, stats_json, started_at, finished_at)
         VALUES (?, ?, 'manual', 'succeeded', 'complete', 'fake-campus-v1',
          'fake-campus-v1', 'fake-v1', 'fake-source-hash',
          '{"discovered":3,"created":3}', 1, 2)`,
      )
      .run(ids.syncRun, ids.source);

    const [activeJob, staleJob, closedJob] = adapter.jobs.map((job) => adapter.normalize(job));
    if (!activeJob || !staleJob || !closedJob)
      throw new Error('FakeAdapter fixture is incomplete.');
    insertJob(database, activeJob, {
      id: ids.activeJob,
      status: 'active',
      rawId: ids.activeRaw,
      revisionId: ids.activeRevision,
      updatedAt: 3,
    });
    insertJob(database, staleJob, {
      id: ids.staleJob,
      status: 'stale',
      rawId: ids.staleRaw,
      revisionId: ids.staleRevision,
      updatedAt: 2,
    });
    insertJob(database, closedJob, {
      id: ids.closedJob,
      status: 'closed',
      rawId: '018f0000-0000-7000-8000-000000000505',
      revisionId: '018f0000-0000-7000-8000-000000000506',
      updatedAt: 1,
    });

    database.client
      .prepare(
        `INSERT INTO candidate_profiles (id, name, created_at, updated_at)
         VALUES (?, '校招实习求职画像', 1, 1)`,
      )
      .run(ids.profile);
    database.client
      .prepare(
        `INSERT INTO profile_versions
         (id, profile_id, version_no, extracted_json, effective_json, locked_paths_json,
          content_hash, is_current, created_at)
         VALUES (?, ?, 1, ?, ?, '[]', ?, 1, 1)`,
      )
      .run(
        ids.profileVersion,
        ids.profile,
        JSON.stringify(profile),
        JSON.stringify(profile),
        'd'.repeat(64),
      );
    database.client
      .prepare(
        `INSERT INTO match_rulesets
         (id, version, definition_json, definition_hash, active, created_at)
         VALUES (?, 'campus-v1', '{"version":"campus-v1"}', ?, 1, 1)`,
      )
      .run(ids.ruleset, 'e'.repeat(64));
    database.client
      .prepare(
        `INSERT INTO match_results
         (id, profile_version_id, job_revision_id, ruleset_id, filter_status, total_score,
          components_json, risks_json, input_hash, created_at)
         VALUES (?, ?, ?, ?, 'eligible', 86.5, ?, ?, ?, 3)`,
      )
      .run(
        ids.match,
        ids.profileVersion,
        ids.activeRevision,
        ids.ruleset,
        JSON.stringify([
          {
            dimension: 'skills',
            score: 31,
            maximumScore: 35,
            matchedEvidence: [
              { source: 'profile', path: '/skills/0', summary: '具备 TypeScript Agent 项目经验' },
            ],
            missingEvidence: ['生产级评测经验'],
            uncertainties: [],
          },
          {
            dimension: 'experience',
            score: 22,
            maximumScore: 25,
            matchedEvidence: [
              { source: 'job', path: '/experienceText', summary: '接受在校生申请' },
            ],
            missingEvidence: [],
            uncertainties: ['实习时长待确认'],
          },
        ]),
        JSON.stringify([
          {
            ruleId: 'campus-education',
            status: 'pass',
            evidence: [{ source: 'profile', path: '/education/0', summary: '本科在读' }],
            explanation: '学历要求与校招实习画像匹配',
          },
        ]),
        'f'.repeat(64),
      );
    database.client
      .prepare(
        `INSERT INTO tasks
         (id, task_type, payload_json, status, idempotency_key, attempt_count, max_attempts,
          available_at, created_at)
         VALUES (?, 'source.sync', '{"sourceId":"campus"}', 'pending',
          'fixture-pending-sync', 0, 3, 1, 2)`,
      )
      .run(ids.task);
    database.client
      .prepare(
        `INSERT INTO agent_runs
         (id, agent_key, agent_version, prompt_version, model_config_hash, input_hash,
          cache_key, status, output_json, input_tokens, output_tokens, estimated_cost_micros,
          cost_currency, pricing_version, started_at, finished_at)
         VALUES (?, 'job-understanding', 'fake-v1', 'campus-prompt-v1', 'fake-config',
          'fake-input', 'fake-cache', 'succeeded', '{"summary":"脱敏校招实习职位理解"}',
          120, 80, 1000, 'USD', 'fake-price-v1', 2, 3)`,
      )
      .run(ids.agentRun);
    database.client
      .prepare(
        `INSERT INTO agent_tool_calls
         (id, agent_run_id, sequence_no, tool_key, input_summary_json, output_summary_json,
          status, duration_ms)
         VALUES (?, ?, 0, 'fixture.lookup', '{}', '{"ok":true}', 'succeeded', 12)`,
      )
      .run(ids.toolCall, ids.agentRun);
  } finally {
    database.close();
  }
}

const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'jobhunter-web-browser-'));
await seedFixture(dataRoot);

const require = createRequire(import.meta.url);
const nextBin = require.resolve('next/dist/bin/next');
const workspaceRoot = path.resolve(import.meta.dirname, '../../../..');
const port = process.env.PLAYWRIGHT_FIXTURE_PORT ?? '3210';
const child = spawn(process.execPath, [nextBin, 'dev', '--hostname', '127.0.0.1', '--port', port], {
  stdio: 'inherit',
  env: {
    ...process.env,
    JOBHUNTER_DATA_ROOT: dataRoot,
    JOBHUNTER_WORKSPACE_ROOT: workspaceRoot,
    NEXT_DIST_DIR: '.next-browser-fixture',
  },
});

let cleaned = false;
const cleanup = async (): Promise<void> => {
  if (cleaned) return;
  cleaned = true;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await rm(dataRoot, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EBUSY')) throw error;
      await delay(250);
    }
  }
  await rm(dataRoot, { recursive: true, force: true });
};

child.once('exit', (code, signal) => {
  void cleanup().finally(() => {
    process.exitCode = code ?? (signal ? 1 : 0);
  });
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    child.kill(signal);
  });
}
