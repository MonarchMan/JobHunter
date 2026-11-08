import { seedUsageFixture } from './usage-fixture.js';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { makeCandidateProfile } from '@jobhunter/user/testing';
import { FakeModel } from '@jobhunter/common/testing';
import { openSqliteDatabase } from '@jobhunter/common/persistence/connection';
import { SqliteRecruitmentMailRepository } from '@jobhunter/recruitment/persistence/sqlite-recruitment-mail-repository';
import { seedPlatformJobs } from '../fixtures/platform-jobs.js';
import { browserFixtureAddress } from '../../src/server/browser-test-isolation.js';
import { calculateDeterministicMatch } from '@jobhunter/matching';
import { contentHash, utcInstant } from '@jobhunter/common/domain';
import { parseNormalizedJob, type NormalizedJob } from '@jobhunter/recruitment/domain';
import type { CandidateProfileData } from '@jobhunter/user/domain';

const ids = {
  company: '018f0000-0000-7000-8f00-000000000101',
  channel: '018f0000-0000-7000-8f00-000000000102',
  source: '018f0000-0000-7000-8f00-000000000201',
  syncRun: '018f0000-0000-7000-8000-000000000301',
  activeJob: '018f0000-0000-7000-8000-000000000401',
  staleJob: '018f0000-0000-7000-8000-000000000402',
  closedJob: '018f0000-0000-7000-8000-000000000403',
  activeRaw: '018f0000-0000-7000-8000-000000000501',
  staleRaw: '018f0000-0000-7000-8000-000000000502',
  activeContent: '018f0000-0000-7000-8000-000000000503',
  staleContent: '018f0000-0000-7000-8000-000000000504',
  profile: '018f0000-0000-7000-8000-000000000601',
  profileVersion: '018f0000-0000-7000-8000-000000000602',
  interviewProfile: '018f0000-0000-7000-8000-000000000611',
  interviewProfileVersion: '018f0000-0000-7000-8000-000000000612',
  studioProfile: '018f0000-0000-7000-8000-000000000621',
  studioProfileVersion: '018f0000-0000-7000-8000-000000000622',
  deepSnapshot: '018f0000-0000-7000-8000-000000000901',
  deepDossier: '018f0000-0000-7000-8000-000000000902',
  deepMaterialFile: '018f0000-0000-7000-8000-000000000903',
  deepMaterialEntity: '018f0000-0000-7000-8000-000000000904',
  deepMaterialChunk: '018f0000-0000-7000-8000-000000000905',
  deepSession: '018f0000-0000-7000-8000-000000000906',
  deepTurn: '018f0000-0000-7000-8000-000000000907',
  match: '018f0000-0000-7000-8000-000000000604',
  task: '018f0000-0000-7000-8000-000000000701',
  agentRun: '018f0000-0000-7000-8000-000000000801',
  toolCall: '018f0000-0000-7000-8000-000000000802',
  calendarMail: '018f0000-0000-7000-8000-000000000811',
  calendarApplication: '018f0000-0000-7000-8000-000000000812',
  calendarEvent: '018f0000-0000-7000-8000-000000000813',
  calendarExpiredMail: '018f0000-0000-7000-8000-000000000814',
  calendarExpiredEvent: '018f0000-0000-7000-8000-000000000815',
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
    publishedAt: Date.parse('2026-08-01T16:30:00.000Z'),
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
/** 构造测试输入或执行断言的辅助逻辑。 */
class FakeAdapter {
  public readonly jobs = campusJobs;

  public normalize(job: NormalizedJob): NormalizedJob {
    return job;
  }
}

/** 构造测试输入或执行断言的辅助逻辑。 */
async function loadProfileFromFakeModel(): Promise<CandidateProfileData> {
  const model = new FakeModel<{ readonly resume: string }, CandidateProfileData>();
  const profile = makeCandidateProfile({
    targetRoles: ['研发', '大模型应用实习生', 'Agent 实习生'],
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
    professionalSkills:
      '熟练使用 TypeScript 构建类型安全的前端应用。\n具备大模型应用与 Agent 工作流开发经验。',
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
    readonly contentId: string;
    readonly updatedAt: number;
  },
): void {
  database.client
    .prepare(
      `INSERT INTO jobs
       (id, company_id, source_id, external_job_id, title, department, job_family,
        locations_json, employment_type, recruitment_category, experience_text, education_text, description,
        detail_url, apply_url, status, missing_count, content_hash, first_seen_at,
        last_seen_at, created_at, updated_at, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 1, ?, 1, ?, ?)`,
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
      job.publishedAt,
    );
  database.client
    .prepare(
      `UPDATE jobs SET content_id=?,content_hash=?,source_payload_hash=?,source_url=?  WHERE jobs.id=?`,
    )
    .run(input.contentId, 'c'.repeat(64), 'b'.repeat(64), job.detailUrl, input.id);
}

/** 构造测试输入或执行断言的辅助逻辑。 */
async function seedFixture(dataRoot: string): Promise<void> {
  const database = openSqliteDatabase({ dataRoot });
  seedPlatformJobs(database, { bossCount: 11 });
  const adapter = new FakeAdapter();
  const profile = await loadProfileFromFakeModel();
  const interviewProfile = makeCandidateProfile({
    targetRoles: [],
    projects: [
      {
        name: '校招职位 Agent',
        role: '核心开发者',
        startDate: '2026-03-01',
        endDate: null,
        highlights: ['实现可追溯的职位同步、匹配与后台任务恢复'],
        evidence: [{ source: 'resume', quote: '校招职位 Agent 项目' }],
      },
      {
        name: '文档检索网关',
        role: '后端负责人',
        startDate: '2026-05-01',
        endDate: null,
        highlights: ['通过短事务与异步 Worker 隔离外部调用'],
        evidence: [{ source: 'resume', quote: '文档检索网关项目' }],
      },
    ],
  });
  try {
    database.client
      .prepare(
        `INSERT INTO application_settings (key, value_json, schema_version, updated_at)
         VALUES ('sources.activeChannel', '{"channel":"campus"}', '1', 1)
         ON CONFLICT(key) DO UPDATE SET
           value_json = excluded.value_json,
           schema_version = excluded.schema_version,
           updated_at = excluded.updated_at`,
      )
      .run();
    database.client
      .prepare(
        `INSERT INTO companies (id, slug, name, aliases_json, enabled, created_at, updated_at)
         VALUES (?, 'browser-fixture-tencent', '腾讯校招', '[]', 1, 1, 1)`,
      )
      .run(ids.company);
    database.client
      .prepare(
        `INSERT INTO source_channels
         (id, company_id, channel, slug, enabled, created_at, updated_at)
         VALUES (?, ?, 'campus', 'browser-fixture-tencent-campus', 1, 1, 1)`,
      )
      .run(ids.channel, ids.company);
    database.client
      .prepare(
        `INSERT INTO job_sources
         (id, company_id, channel_id, slug, adapter_key, base_url, config_json,
          sync_policy_version, sync_policy_json, enabled, support_status, health_status,
          consecutive_failures, last_success_at, created_at, updated_at)
         VALUES (?, ?, ?, 'browser-fixture-tencent-campus', 'fake.campus',
          'https://careers.tencent.com/campus', '{}', 'fake-v1', '{}', 1,
          'supported', 'healthy', 0, 2, 1, 2)`,
      )
      .run(ids.source, ids.company, ids.channel);
    database.client
      .prepare(
        `WITH scan_input (id, source_id, trigger, status, coverage, stats_json, started_at, finished_at) AS (VALUES (?, ?, 'manual', 'succeeded', 'complete', '{"discovered":3,"created":3}', 1, 2))
INSERT INTO tasks(id,task_type,private_state,public_state,status,idempotency_key,attempt_count,max_attempts,available_at,created_at,started_at,finished_at,error_category,error_summary) SELECT id,'source.scan',json_object('sourceId',source_id,'trigger',trigger),json_object('status',status,'coverage',coverage,'stats',json(scan_input.stats_json),'coverageEvidence',json('{}')),CASE WHEN status='partial' THEN 'succeeded' ELSE status END,'source.scan:'||id,1,1,started_at,started_at,started_at,scan_input.finished_at,NULL,NULL FROM scan_input`,
      )
      .run(ids.syncRun, ids.source);

    // 工作台日历夹具使用相对当前时间，确保任意测试日期都能看到近期安排。
    const calendarRepository = new SqliteRecruitmentMailRepository(database.client);
    const calendarStart = utcInstant(Date.now() + 24 * 60 * 60 * 1000);
    calendarRepository.upsertMessageRef({
      id: ids.calendarMail,
      mailboxKey: 'browser-fixture',
      providerKey: 'imap',
      externalMessageKey: 'calendar-interview',
      folderId: 'INBOX',
      threadKeyHash: null,
      sourceUrl: null,
      receivedAt: Date.now(),
      contentVersion: 'calendar-v1',
      contentHash: '7'.repeat(64),
      processingStatus: 'accepted',
      lastClassifierKind: 'agent',
      lastClassifierVersion: 'fixture-v1',
      lastSeenAt: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    calendarRepository.appendAcceptedApplicationEvent({
      applicationId: ids.calendarApplication,
      companyName: '未来科技',
      roleTitle: 'AI 应用工程师',
      mailMessageRefId: ids.calendarMail,
      sourceContentHash: '7'.repeat(64),
      sourceEventNo: 1,
      acceptanceKind: 'automatic',
      classifierKind: 'agent',
      classifierVersion: 'fixture-v1',
      eventType: 'interview_invited',
      effectiveAt: Date.now(),
      receivedAt: Date.now(),
      confidence: 0.98,
      schedule: {
        activityType: 'interview',
        scheduledStartAt: calendarStart,
        scheduledEndAt: null,
        deadlineAt: null,
        scheduledStartLocalDate: null,
        scheduledEndLocalDate: null,
        deadlineLocalDate: null,
        previousScheduledStartAt: null,
        previousScheduledStartLocalDate: null,
        timePrecision: 'exact_time',
        timezoneSource: 'explicit',
        timezoneText: 'Asia/Shanghai',
        stageLabel: '技术一面',
      },
      location: '腾讯会议',
      meetingUrl: 'https://meeting.example.com/fixture',
      actionUrl: null,
      payloadJson: JSON.stringify({ fixture: true }),
      eventId: ids.calendarEvent,
      now: Date.now(),
    });
    const pastDeadlineDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(Date.now() - 24 * 60 * 60 * 1000);
    calendarRepository.upsertMessageRef({
      id: ids.calendarExpiredMail,
      mailboxKey: 'browser-fixture',
      providerKey: 'imap',
      externalMessageKey: 'calendar-written-exam',
      folderId: 'INBOX',
      threadKeyHash: null,
      sourceUrl: null,
      receivedAt: Date.now() - 48 * 60 * 60 * 1000,
      contentVersion: 'calendar-v2',
      contentHash: '8'.repeat(64),
      processingStatus: 'accepted',
      lastClassifierKind: 'agent',
      lastClassifierVersion: 'fixture-v2',
      lastSeenAt: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    calendarRepository.appendAcceptedApplicationEvent({
      applicationId: ids.calendarApplication,
      companyName: '未来科技',
      roleTitle: 'AI 应用工程师',
      mailMessageRefId: ids.calendarExpiredMail,
      sourceContentHash: '8'.repeat(64),
      sourceEventNo: 1,
      acceptanceKind: 'automatic',
      classifierKind: 'agent',
      classifierVersion: 'fixture-v2',
      eventType: 'assessment_invited',
      effectiveAt: Date.now() - 48 * 60 * 60 * 1000,
      receivedAt: Date.now() - 48 * 60 * 60 * 1000,
      confidence: 0.98,
      schedule: {
        activityType: 'written_exam',
        scheduledStartAt: null,
        scheduledEndAt: null,
        deadlineAt: null,
        scheduledStartLocalDate: null,
        scheduledEndLocalDate: null,
        deadlineLocalDate: pastDeadlineDate,
        previousScheduledStartAt: null,
        previousScheduledStartLocalDate: null,
        timePrecision: 'date_only',
        timezoneSource: 'not_applicable',
        timezoneText: null,
        stageLabel: '在线笔试',
      },
      location: null,
      meetingUrl: null,
      actionUrl: 'https://assessment.example.com/fixture',
      payloadJson: JSON.stringify({ fixture: true }),
      eventId: ids.calendarExpiredEvent,
      now: Date.now(),
    });

    const [activeJob, staleJob, closedJob] = adapter.jobs.map((job) => adapter.normalize(job));
    if (!activeJob || !staleJob || !closedJob)
      throw new Error('FakeAdapter fixture is incomplete.');
    insertJob(database, activeJob, {
      id: ids.activeJob,
      status: 'active',
      contentId: ids.activeContent,
      updatedAt: 3,
    });
    insertJob(database, staleJob, {
      id: ids.staleJob,
      status: 'stale',
      contentId: ids.staleContent,
      updatedAt: 2,
    });
    insertJob(database, closedJob, {
      id: ids.closedJob,
      status: 'closed',
      contentId: '018f0000-0000-7000-8000-000000000506',
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
        `WITH profile_input (id, profile_id, version_no, profile_json, content_hash, is_current, created_at) AS (VALUES (?, ?, 1, ?, ?, 1, 1))
INSERT INTO profile_versions (id,profile_id,version_no,content_hash,is_current,created_at,matching_constraints_json,basic_info_json,target_roles_json,intended_roles_json,preferences_json,education_json,work_experience_json,projects_json,works_json,competitions_json,certificates_json,languages_json,professional_skills,self_evaluation,skills_json,domains_json,years_of_experience,management_experience)
SELECT id,profile_id,version_no,content_hash,is_current,created_at,COALESCE(json_extract(profile_json,'$.matchingConstraints'),'{}'),COALESCE(json_extract(profile_json,'$.basicInfo'),'{}'),COALESCE(json_extract(profile_json,'$.targetRoles'),'[]'),COALESCE(json_extract(profile_json,'$.intendedRoles'),'[]'),COALESCE(json_extract(profile_json,'$.preferences'),'{}'),COALESCE(json_extract(profile_json,'$.education'),'[]'),COALESCE(json_extract(profile_json,'$.workExperience'),'[]'),COALESCE(json_extract(profile_json,'$.projects'),'[]'),COALESCE(json_extract(profile_json,'$.works'),'[]'),COALESCE(json_extract(profile_json,'$.competitions'),'[]'),COALESCE(json_extract(profile_json,'$.certificates'),'[]'),COALESCE(json_extract(profile_json,'$.languages'),'[]'),json_extract(profile_json,'$.professionalSkills'),json_extract(profile_json,'$.selfEvaluation'),COALESCE(json_extract(profile_json,'$.skills'),'[]'),COALESCE(json_extract(profile_json,'$.domains'),'[]'),json_extract(profile_json,'$.yearsOfExperience'),json_extract(profile_json,'$.managementExperience') FROM profile_input`,
      )
      .run(ids.profileVersion, ids.profile, JSON.stringify(profile), 'd'.repeat(64));
    database.client
      .prepare(
        `INSERT INTO candidate_profiles (id, name, created_at, updated_at)
         VALUES (?, '面试准备画像', 2, 2)`,
      )
      .run(ids.interviewProfile);
    database.client
      .prepare(
        `WITH profile_input (id, profile_id, version_no, profile_json, content_hash, is_current, created_at) AS (VALUES (?, ?, 1, ?, ?, 1, 2))
INSERT INTO profile_versions (id,profile_id,version_no,content_hash,is_current,created_at,matching_constraints_json,basic_info_json,target_roles_json,intended_roles_json,preferences_json,education_json,work_experience_json,projects_json,works_json,competitions_json,certificates_json,languages_json,professional_skills,self_evaluation,skills_json,domains_json,years_of_experience,management_experience)
SELECT id,profile_id,version_no,content_hash,is_current,created_at,COALESCE(json_extract(profile_json,'$.matchingConstraints'),'{}'),COALESCE(json_extract(profile_json,'$.basicInfo'),'{}'),COALESCE(json_extract(profile_json,'$.targetRoles'),'[]'),COALESCE(json_extract(profile_json,'$.intendedRoles'),'[]'),COALESCE(json_extract(profile_json,'$.preferences'),'{}'),COALESCE(json_extract(profile_json,'$.education'),'[]'),COALESCE(json_extract(profile_json,'$.workExperience'),'[]'),COALESCE(json_extract(profile_json,'$.projects'),'[]'),COALESCE(json_extract(profile_json,'$.works'),'[]'),COALESCE(json_extract(profile_json,'$.competitions'),'[]'),COALESCE(json_extract(profile_json,'$.certificates'),'[]'),COALESCE(json_extract(profile_json,'$.languages'),'[]'),json_extract(profile_json,'$.professionalSkills'),json_extract(profile_json,'$.selfEvaluation'),COALESCE(json_extract(profile_json,'$.skills'),'[]'),COALESCE(json_extract(profile_json,'$.domains'),'[]'),json_extract(profile_json,'$.yearsOfExperience'),json_extract(profile_json,'$.managementExperience') FROM profile_input`,
      )
      .run(
        ids.interviewProfileVersion,
        ids.interviewProfile,
        JSON.stringify(interviewProfile),
        '9'.repeat(64),
      );

    // 简历制作使用独立画像；创建时间排在既有画像之后，保持默认画像不变。
    database.client
      .prepare(
        `INSERT INTO candidate_profiles (id, name, created_at, updated_at)
         VALUES (?, '简历制作专用画像', 3, 3)`,
      )
      .run(ids.studioProfile);
    database.client
      .prepare(
        `WITH profile_input (id, profile_id, version_no, profile_json, content_hash, is_current, created_at) AS (VALUES (?, ?, 1, ?, ?, 1, 3))
INSERT INTO profile_versions (id,profile_id,version_no,content_hash,is_current,created_at,matching_constraints_json,basic_info_json,target_roles_json,intended_roles_json,preferences_json,education_json,work_experience_json,projects_json,works_json,competitions_json,certificates_json,languages_json,professional_skills,self_evaluation,skills_json,domains_json,years_of_experience,management_experience)
SELECT id,profile_id,version_no,content_hash,is_current,created_at,COALESCE(json_extract(profile_json,'$.matchingConstraints'),'{}'),COALESCE(json_extract(profile_json,'$.basicInfo'),'{}'),COALESCE(json_extract(profile_json,'$.targetRoles'),'[]'),COALESCE(json_extract(profile_json,'$.intendedRoles'),'[]'),COALESCE(json_extract(profile_json,'$.preferences'),'{}'),COALESCE(json_extract(profile_json,'$.education'),'[]'),COALESCE(json_extract(profile_json,'$.workExperience'),'[]'),COALESCE(json_extract(profile_json,'$.projects'),'[]'),COALESCE(json_extract(profile_json,'$.works'),'[]'),COALESCE(json_extract(profile_json,'$.competitions'),'[]'),COALESCE(json_extract(profile_json,'$.certificates'),'[]'),COALESCE(json_extract(profile_json,'$.languages'),'[]'),json_extract(profile_json,'$.professionalSkills'),json_extract(profile_json,'$.selfEvaluation'),COALESCE(json_extract(profile_json,'$.skills'),'[]'),COALESCE(json_extract(profile_json,'$.domains'),'[]'),json_extract(profile_json,'$.yearsOfExperience'),json_extract(profile_json,'$.managementExperience') FROM profile_input`,
      )
      .run(
        ids.studioProfileVersion,
        ids.studioProfile,
        JSON.stringify(profile),
        createHash('sha256').update(JSON.stringify(profile)).digest('hex'),
      );

    // 全页面启动验收独占画像，避免预建草稿影响简历制作交互用例。
    database.client
      .prepare(
        "INSERT INTO candidate_profiles (id,name,created_at,updated_at) VALUES (?, '页面验收画像', 4, 4)",
      )
      .run('018f0000-0000-7000-8000-000000000631');
    database.client
      .prepare(
        `WITH profile_input (id, profile_id, version_no, profile_json, content_hash, is_current, created_at) AS (VALUES (?, ?, 1, ?, ?, 1, 4))
INSERT INTO profile_versions (id,profile_id,version_no,content_hash,is_current,created_at,matching_constraints_json,basic_info_json,target_roles_json,intended_roles_json,preferences_json,education_json,work_experience_json,projects_json,works_json,competitions_json,certificates_json,languages_json,professional_skills,self_evaluation,skills_json,domains_json,years_of_experience,management_experience)
SELECT id,profile_id,version_no,content_hash,is_current,created_at,COALESCE(json_extract(profile_json,'$.matchingConstraints'),'{}'),COALESCE(json_extract(profile_json,'$.basicInfo'),'{}'),COALESCE(json_extract(profile_json,'$.targetRoles'),'[]'),COALESCE(json_extract(profile_json,'$.intendedRoles'),'[]'),COALESCE(json_extract(profile_json,'$.preferences'),'{}'),COALESCE(json_extract(profile_json,'$.education'),'[]'),COALESCE(json_extract(profile_json,'$.workExperience'),'[]'),COALESCE(json_extract(profile_json,'$.projects'),'[]'),COALESCE(json_extract(profile_json,'$.works'),'[]'),COALESCE(json_extract(profile_json,'$.competitions'),'[]'),COALESCE(json_extract(profile_json,'$.certificates'),'[]'),COALESCE(json_extract(profile_json,'$.languages'),'[]'),json_extract(profile_json,'$.professionalSkills'),json_extract(profile_json,'$.selfEvaluation'),COALESCE(json_extract(profile_json,'$.skills'),'[]'),COALESCE(json_extract(profile_json,'$.domains'),'[]'),json_extract(profile_json,'$.yearsOfExperience'),json_extract(profile_json,'$.managementExperience') FROM profile_input`,
      )
      .run(
        '018f0000-0000-7000-8000-000000000632',
        '018f0000-0000-7000-8000-000000000631',
        JSON.stringify(profile),
        createHash('sha256').update(JSON.stringify(profile)).digest('hex'),
      );
    database.client.transaction(() => {
      database.client
        .prepare(
          "INSERT INTO ai_sessions(id,type,title,created_at,updated_at) VALUES(?,'interview','项目面试',3,4)",
        )
        .run(ids.deepSession);
      database.client
        .prepare(
          "INSERT INTO ai_messages(id,session_id,role,content,sequence,status,created_at,updated_at) VALUES(?,?,'assistant',?,1,'completed',3,4)",
        )
        .run(
          ids.deepTurn,
          ids.deepSession,
          '为什么把模型调用放在事务提交之后，失败时如何保持任务可重试？',
        );
    })();

    database.client
      .prepare(
        `INSERT INTO job_metadata(id,job_id,name,value,created_at,updated_at) VALUES ( ?,(SELECT id FROM jobs WHERE content_id=?),'match_result',json_object('content_id',?,'profile_version_id',?,'enrichment_id',NULL,'rules_hash','fixture','filter_status','eligible','total_score',86.5,'input_hash',?,'components',json((SELECT json_group_array(json_object('dimension',json_extract(c.value,'$.dimension'),'score',json_extract(c.value,'$.score'),'max_score',json_extract(c.value,'$.maximumScore'))) FROM json_each(?) c WHERE json_extract(c.value,'$.dimension')!='model')),'risk_results',json((SELECT json_group_array(json_extract(r.value,'$.ruleId')) FROM json_each(?) r WHERE json_extract(r.value,'$.status')='fail')),'unknown_rules',json((SELECT json_group_array(json_extract(r.value,'$.ruleId')) FROM json_each(?) r WHERE json_extract(r.value,'$.status')='unknown')),'model',NULL),3,3 )`,
      )
      .run(
        ids.match,
        ids.activeContent,
        ids.activeContent,
        ids.profileVersion,
        'f'.repeat(64),
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
        JSON.stringify([
          {
            ruleId: 'campus-education',
            status: 'pass',
            evidence: [{ source: 'profile', path: '/education/0', summary: '本科在读' }],
            explanation: '学历要求与校招实习画像匹配',
          },
        ]),
      );
    // 分型详情夹具使用真实纯规则引擎，不改变活动列表的旧评分基线。
    const recruitmentMatch = calculateDeterministicMatch({
      profile: interviewProfile,
      job: campusJobs[1],
      company: { sizeCategory: 'large', industry: null },
      understanding: null,
    });

    database.client
      .prepare(
        `INSERT INTO job_metadata(id,job_id,name,value,created_at,updated_at) VALUES ( ?,(SELECT id FROM jobs WHERE content_id=?),'match_result',json_object('content_id',?,'profile_version_id',?,'enrichment_id',NULL,'rules_hash','fixture','filter_status',?,'total_score',?,'input_hash',?,'components',json((SELECT json_group_array(json_object('dimension',json_extract(c.value,'$.dimension'),'score',json_extract(c.value,'$.score'),'max_score',json_extract(c.value,'$.maximumScore'))) FROM json_each(?) c WHERE json_extract(c.value,'$.dimension')!='model')),'risk_results',json((SELECT json_group_array(json_extract(r.value,'$.ruleId')) FROM json_each(?) r WHERE json_extract(r.value,'$.status')='fail')),'unknown_rules',json((SELECT json_group_array(json_extract(r.value,'$.ruleId')) FROM json_each(?) r WHERE json_extract(r.value,'$.status')='unknown')),'model',NULL),3,3 )`,
      )
      .run(
        '018f0000-0000-7000-8000-000000000632',
        ids.staleContent,
        ids.staleContent,
        ids.interviewProfileVersion,
        recruitmentMatch.filterStatus,
        recruitmentMatch.totalScore,
        contentHash(recruitmentMatch),
        JSON.stringify(recruitmentMatch.components),
        JSON.stringify(recruitmentMatch.ruleOutcomes),
        JSON.stringify(recruitmentMatch.ruleOutcomes),
      );
    database.client
      .prepare(
        `INSERT INTO tasks
         (id, task_type, private_state, status, idempotency_key, attempt_count, max_attempts,
          available_at, created_at)
         VALUES (?, 'source.sync', '{"sourceId":"campus"}', 'pending',
          'fixture-pending-sync', 0, 3, 1, 2)`,
      )
      .run(ids.task);
    // 1、维护记录仅用于只读审计展示，不应提供普通队列的重试/取消入口。
    database.client.exec(`INSERT INTO tasks
      (id,task_type,private_state,status,idempotency_key,attempt_count,max_attempts,available_at,created_at,started_at,finished_at)
      VALUES('018f0000-0000-7000-8000-000000000709','maintenance.sqlite','{}','failed',
      'fixture-maintenance-audit',1,1,1,3,unixepoch('2026-11-07 08:00:00')*1000,unixepoch('2026-11-07 08:01:30')*1000)`);
    database.client
      .prepare(
        `INSERT INTO agent_runs
         (id, agent_key, definition_hash, model_config_hash, input_hash,
          cache_key, status, output_json, input_tokens, output_tokens, estimated_cost_micros,
          cost_currency, pricing_version, started_at, finished_at)
         VALUES (?, 'job-analysis', 'fake-definition', 'fake-config',
          'fake-input', 'fake-cache', 'succeeded', '{"summary":"脱敏校招实习职位分析"}',
          120, 80, 1000, 'USD', 'fake-price-v1', 2, 3)`,
      )
      .run(ids.agentRun);
    seedUsageFixture(database.client, ids.agentRun);
    database.client.exec(`INSERT INTO agent_runs
      (id,agent_key,definition_hash,model_config_hash,input_hash,cache_key,
       status,error_category,error_summary,started_at,finished_at)
      VALUES('018f0000-0000-7000-8000-000000000708','recruitment-mail.classify',
       'fake-definition','fake-config','fake-input-2','fake-cache-2',
       'failed','unknown',NULL,4,5)`);
    database.client
      .prepare(
        `INSERT INTO events
         (id, stream_type, stream_id, sequence_no, event_type, payload_json, occurred_at)
         VALUES (?, 'agent_run', ?, 1, 'agent.tool.finished', ?, 2)`,
      )
      .run(
        ids.toolCall,
        ids.agentRun,
        JSON.stringify({
          toolKey: 'fixture.lookup',
          inputSummary: {},
          outputSummary: { ok: true },
          status: 'succeeded',
          durationMs: 12,
          errorSummary: null,
        }),
      );
    // 当前画像项目使用系统身份；候选提取供选择确认页面验收使用。
    database.client.exec(
      `UPDATE profile_versions SET projects_json=COALESCE((SELECT json_group_array(json_set(value,'$.id',profile_versions.profile_id || ':project:' || key,'$.local_path',NULL)) FROM json_each(profile_versions.projects_json)),'[]');`,
    );
    const candidate = database.client
      .prepare('SELECT * FROM profile_versions WHERE id=?')
      .get(ids.interviewProfileVersion) as Record<string, unknown>;
    database.client
      .prepare(
        'INSERT INTO candidate_profiles(id,name,created_at,updated_at) VALUES(?,?,999999,999999)',
      )
      .run('018f0000-0000-7000-8000-000000000620', '提取确认测试');
    candidate.profile_id = '018f0000-0000-7000-8000-000000000620';
    candidate.target_roles_json = '[]';
    candidate.id = '018f0000-0000-7000-8000-000000000621';
    database.client
      .prepare(
        `INSERT INTO profile_versions (${Object.keys(candidate).join(',')}) VALUES(${Object.keys(
          candidate,
        )
          .map(() => '?')
          .join(',')})`,
      )
      .run(...Object.values(candidate));
    candidate.id = '018f0000-0000-7000-8000-000000000629';
    candidate.version_no = 2;
    candidate.is_current = 0;
    candidate.is_candidate = 1;
    candidate.base_version_id = '018f0000-0000-7000-8000-000000000621';
    candidate.professional_skills = '候选提取：熟练使用 TypeScript';
    candidate.self_evaluation = '此字段未选择时不应应用';
    database.client
      .prepare(
        `INSERT INTO profile_versions (${Object.keys(candidate).join(',')}) VALUES(${Object.keys(
          candidate,
        )
          .map(() => '?')
          .join(',')})`,
      )
      .run(...Object.values(candidate));
  } finally {
    database.close();
  }
}

// 1、在创建夹具数据前核验地址，直接启动也不能回退到日常 Web 端口。
const fixtureAddress = browserFixtureAddress(process.env);
const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'jobhunter-web-browser-'));
const fixtureCredentialRef = 'os:jobhunter/mail/browser-fixture-qq';
await seedFixture(dataRoot);
await mkdir(path.join(dataRoot, 'mail'), { recursive: true });
await writeFile(
  path.join(dataRoot, 'mail', 'mailboxes.json'),
  `${JSON.stringify(
    {
      version: 1,
      mailboxes: [
        {
          mailboxKey: 'browser-fixture-qq',
          providerKey: 'imap',
          maskedAddress: 'f***@qq.com',
          credentialRef: fixtureCredentialRef,
          folders: ['INBOX'],
          initialLookbackDays: 90,
          enabled: true,
        },
      ],
    },
    null,
    2,
  )}\n`,
  'utf8',
);

// 浏览器用例使用本地 OpenAI 兼容端点，验证 Web 同步生成链路且不依赖公网模型。
const modelServer = createServer((request, response) => {
  let body = '';
  request.setEncoding('utf8');
  request.on('data', (chunk: string) => {
    body += chunk;
  });
  request.on('end', () => {
    // 1、读取 Agent 输入中的允许证据；2、返回满足结构化契约的确定性问题。
    const payload = JSON.parse(body) as {
      readonly messages: readonly { readonly role: string; readonly content: string }[];
    };
    const userMessage = payload.messages.find((message) => message.role === 'user');
    const agentRequest = JSON.parse(userMessage?.content ?? '{}') as {
      readonly input?: {
        readonly allowedEvidenceRefs?: readonly { readonly kind: string; readonly id: string }[];
      };
    };
    // 深档必须引用已选资料；浅档仍使用简历项目引用。
    const evidence =
      agentRequest.input?.allowedEvidenceRefs?.find((item) => item.kind === 'project_material') ??
      agentRequest.input?.allowedEvidenceRefs?.[0];
    setTimeout(() => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'stop',
              message: {
                content: JSON.stringify({
                  question: '这个项目最初要解决什么问题，你如何判断目标已经达成？',
                  intent: '确认项目背景和成功标准。',
                  primaryDimension: 'background_goal',
                  guidanceSlots: ['业务背景', '目标用户', '成功标准'],
                  evidenceRefs: evidence ? [evidence] : [],
                }),
              },
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 40 },
        }),
      );
    }, 800);
  });
});
await new Promise<void>((resolve, reject) => {
  modelServer.once('error', reject);
  modelServer.listen(0, '127.0.0.1', resolve);
});
const modelAddress = modelServer.address();
if (!modelAddress || typeof modelAddress === 'string') {
  throw new Error('Browser fixture model server did not bind a TCP port.');
}

const require = createRequire(import.meta.url);
const nextBin = require.resolve('next/dist/bin/next');
const workspaceRoot = path.resolve(import.meta.dirname, '../../../..');
const port = fixtureAddress.port;
const child = spawn(process.execPath, [nextBin, 'dev', '--hostname', '127.0.0.1', '--port', port], {
  stdio: 'inherit',
  env: {
    ...process.env,
    DATA_ROOT: dataRoot,
    JOBHUNTER_WORKSPACE_ROOT: workspaceRoot,
    BASE_URL: `http://127.0.0.1:${String(modelAddress.port)}/v1`,
    MODEL: 'browser-fixture',
    API_KEY: 'browser-fixture-key',
    NEXT_DIST_DIR: process.env.NEXT_DIST_DIR ?? '.next-browser-fixture',
  },
});

let cleaned = false;
const cleanup = async (): Promise<void> => {
  if (cleaned) return;
  cleaned = true;
  modelServer.close();
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
