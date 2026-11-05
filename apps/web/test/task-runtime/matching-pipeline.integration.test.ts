import { SqliteProfileDerivedDataManager } from '@jobhunter/matching/persistence/profile-derived-data-manager';
import { SqliteMatchingJobReader } from '@jobhunter/recruitment/persistence/matching-job-reader';
import { SqliteProfileIdentityReader } from '@jobhunter/user/persistence/profile-identity-reader';
import {
  AgentRunner,
  agentDefinitionHash,
  hashCanonical,
  ModelClientError,
  type ModelRequest,
} from '@jobhunter/common/agent';
import {
  CurrentMatchQueryService,
  DeterministicMatchingService,
  MatchAdviceQueryService,
  MatchingBatchService,
  createJobAdviceTaskHandler,
  createJobUnderstandingTaskHandler,
  createMatchRevisionTaskHandler,
  createBatchJobScoreTaskHandler,
  createManualJobScoreTaskHandler,
  MatchWorkflowService,
} from '@jobhunter/matching/application';
import type { TaskHandlerContext, TaskLogger } from '@jobhunter/common/tasks';
import { HandlerRegistry, TaskService } from '@jobhunter/common/tasks';
import { SqliteTaskRepository } from '@jobhunter/common/persistence/tasks';
import {
  canonicalJson,
  contentHash,
  parseId,
  utcInstant,
  type Clock,
  type IdGenerator,
  type UtcInstant,
} from '@jobhunter/common/domain';
import { normalizedJobContentHash, parseNormalizedJob } from '@jobhunter/recruitment/domain';
import { parseCandidateProfile } from '@jobhunter/user/domain';
import { FakeModelClient } from '@jobhunter/common/models';
import { jobAdviceAgentDefinition } from '@jobhunter/matching';
import { createTemporaryDataRoot } from '@jobhunter/common/testing';
import { afterEach, describe, expect, it } from 'vitest';
import {
  openSqliteDatabase,
  type SqliteDatabaseHandle,
} from '@jobhunter/common/persistence/connection';
import { SqliteAgentRunStore } from '@jobhunter/common/persistence/agent-runs';
import { SqliteCandidateProfileRepository } from '@jobhunter/user/persistence';
import { SqliteMatchingRepository } from '@jobhunter/matching/persistence';

/** 构造测试输入或执行断言的辅助逻辑。 */
class AdvancingClock implements Clock {
  #value = 1_800_000_000_000;

  public now(): UtcInstant {
    this.#value += 1;
    return utcInstant(this.#value);
  }
}

/** 构造测试输入或执行断言的辅助逻辑。 */
class SequentialIds implements IdGenerator {
  #counter = 0xd000;

  public generate(): string {
    const suffix = this.#counter.toString(16).padStart(12, '0');
    this.#counter += 1;
    return `018f0000-0000-7000-8000-${suffix}`;
  }
}

const silentLogger: TaskLogger = {
  info(event, fields): void {
    void event;
    void fields;
  },
  warn(event, fields): void {
    void event;
    void fields;
  },
  error(event, fields): void {
    void event;
    void fields;
  },
};

const resources: {
  readonly root: Awaited<ReturnType<typeof createTemporaryDataRoot>>;
  readonly handle: SqliteDatabaseHandle;
}[] = [];

afterEach(async () => {
  for (const resource of resources.splice(0)) {
    resource.handle.close();
    await resource.root.cleanup();
  }
});

const companyId = parseId('018f0000-0000-7000-8000-00000000d001', 'Company');
const sourceId = parseId('018f0000-0000-7000-8000-00000000d002', 'JobSource');
const revisionId = parseId('018f0000-0000-7000-8000-00000000d003', 'JobRevision');
const jobId = parseId('018f0000-0000-7000-8000-00000000d006', 'Job');
const profileId = parseId('018f0000-0000-7000-8000-00000000d007', 'CandidateProfile');
const profileVersionId = parseId('018f0000-0000-7000-8000-00000000d004', 'ProfileVersion');

const normalizedJob = parseNormalizedJob({
  companyId,
  sourceId,
  externalJobId: 'agent-job',
  title: '大模型 Agent 开发工程师',
  department: '平台研发',
  jobFamily: '研发',
  locations: ['深圳'],
  employmentType: '全职',
  experienceText: '要求 3 年以上研发经验',
  educationText: null,
  description: '负责 TypeScript Agent 框架和 RAG 检索系统研发。',
  detailUrl: 'https://careers.example.com/jobs/agent-job',
  applyUrl: 'https://careers.example.com/jobs/agent-job/apply',
  publishedAt: utcInstant(1_700_000_000_000),
});

const profile = parseCandidateProfile({
  targetRoles: ['Agent 开发'],
  preferences: {
    locations: ['深圳'],
    companySizes: ['large'],
    employmentTypes: ['全职'],
    excludedTerms: [],
    remoteAccepted: null,
  },
  education: [],
  workExperience: [],
  projects: [],
  skills: [
    { name: 'TypeScript', level: 'proficient', evidence: [{ source: 'resume', quote: 'TS' }] },
    { name: 'RAG', level: 'proficient', evidence: [{ source: 'resume', quote: 'RAG' }] },
  ],
  domains: ['大模型应用'],
  yearsOfExperience: 5,
  managementExperience: false,
});

function understandingOutput(request: ModelRequest): unknown {
  // 1. Agent 输入包含职位正文与画像快照，快照只含匹配判断所需最小事实。
  expect(request.input).toEqual({
    title: normalizedJob.title,
    description: normalizedJob.description,
    experienceText: normalizedJob.experienceText,
    educationText: normalizedJob.educationText,
    recruitmentCategory: 'unknown',
    locations: normalizedJob.locations,
    employmentType: normalizedJob.employmentType,
    company: { sizeCategory: 'large', industry: '大模型应用' },
    profile: {
      targetRoles: ['Agent 开发'],
      domains: ['大模型应用'],
      yearsOfExperience: 5,
      skills: profile.skills,
      professionalSkills: null,
      education: profile.education,
      preferences: profile.preferences,
      workExperience: profile.workExperience,
      projects: profile.projects,
      works: [],
      competitions: [],
      certificates: [],
      languages: [],
    },
  });
  return {
    requiredSkills: [
      { value: 'TypeScript', evidence: [{ field: 'description', quote: 'TypeScript' }] },
      { value: 'RAG', evidence: [{ field: 'description', quote: 'RAG' }] },
    ],
    preferredSkills: [],
    minimumYearsExperience: {
      value: 3,
      evidence: [{ field: 'experienceText', quote: '3 年以上' }],
    },
    seniority: null,
    domains: [{ value: '大模型应用', evidence: [{ field: 'title', quote: '大模型' }] }],
    fitScore: 90,
    reasons: ['技能与方向高度重合'],
  };
}

async function setup(): Promise<{
  readonly handle: SqliteDatabaseHandle;
  readonly clock: AdvancingClock;
  readonly ids: SequentialIds;
  readonly matching: SqliteMatchingRepository;
  readonly profiles: SqliteCandidateProfileRepository;
  readonly context: TaskHandlerContext;
}> {
  const root = await createTemporaryDataRoot('jobhunter-matching-');
  const handle = openSqliteDatabase({ dataRoot: root.path });
  resources.push({ root, handle });
  const clock = new AdvancingClock();
  const ids = new SequentialIds();
  handle.client
    .prepare(
      `INSERT INTO companies
       (id, slug, name, aliases_json, industry, size_tag, enabled, created_at, updated_at)
       VALUES (?, 'fixture-match', 'Fixture Match', '[]', '大模型应用', 'large', 1, 1, 1)`,
    )
    .run(companyId);
  const channelId = '018f0000-0000-7000-8200-000000000103';
  handle.client
    .prepare(
      `INSERT INTO source_channels
       (id, company_id, channel, slug, enabled, created_at, updated_at)
       VALUES (?, ?, 'social', 'fixture-match-social', 1, 1, 1)`,
    )
    .run(channelId, companyId);
  handle.client
    .prepare(
      `INSERT INTO job_sources
       (id, company_id, channel_id, slug, adapter_key, base_url, config_json,
        sync_policy_version, sync_policy_json, enabled, support_status, health_status,
        consecutive_failures, created_at, updated_at)
       VALUES (?, ?, ?, 'fixture-match-social', 'fixture.match',
               'https://careers.example.com', '{}', 'v1', '{}', 1, 'supported', 'healthy', 0, 1, 1)`,
    )
    .run(sourceId, companyId, channelId);
  handle.client
    .prepare(
      `WITH scan_fixture(id, source_id, trigger, status, coverage, adapter_version, normalizer_version,
        sync_policy_version, source_config_hash, stats_json, started_at, finished_at) AS (VALUES ('sync-match', ?, 'manual', 'succeeded', 'complete', '1', '1', 'v1', ?, '{}', 1, 2)) INSERT INTO tasks(id,task_type,private_state,public_state,status,idempotency_key,attempt_count,max_attempts,available_at,created_at,started_at,finished_at,error_category,error_summary) SELECT id,'source.scan',json_object('sourceId',source_id,'trigger',trigger),json_object('status',status,'coverage',coverage,'stats',json(scan_fixture.stats_json),'coverageEvidence',json('{}')),CASE WHEN status='partial' THEN 'succeeded' ELSE status END,'source.scan:'||id,1,1,started_at,started_at,started_at,scan_fixture.finished_at,NULL,NULL FROM scan_fixture`,
    )
    .run(sourceId, 'a'.repeat(64));
  handle.client
    .prepare(
      `INSERT INTO jobs
       (id, company_id, source_id, external_job_id, title, department, job_family,
        locations_json, employment_type, experience_text, education_text, description,
        detail_url, apply_url, published_at, status, missing_count, content_hash,
        first_seen_at, last_seen_at, closed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 0, ?,
               1, 2, NULL, 1, 2)`,
    )
    .run(
      jobId,
      normalizedJob.companyId,
      normalizedJob.sourceId,
      normalizedJob.externalJobId,
      normalizedJob.title,
      normalizedJob.department,
      normalizedJob.jobFamily,
      canonicalJson(normalizedJob.locations),
      normalizedJob.employmentType,
      normalizedJob.experienceText,
      normalizedJob.educationText,
      normalizedJob.description,
      normalizedJob.detailUrl,
      normalizedJob.applyUrl,
      normalizedJob.publishedAt,
      normalizedJobContentHash(normalizedJob),
    );
  handle.client
    .prepare(
      `UPDATE jobs SET content_id=d.id,content_hash=d.content_hash,source_payload_hash=d.source_payload_hash,source_url=d.source_url FROM (SELECT ? AS id, ? AS job_id, 1 AS revision_no, ? AS content_hash, '1' AS normalizer_version, ? AS source_payload_hash, 'https://careers.example.com/jobs/agent-job' AS source_url, ? AS snapshot_json, '[]' AS change_set_json, 1 AS created_at) d WHERE jobs.id=d.job_id`,
    )
    .run(
      revisionId,
      jobId,
      normalizedJobContentHash(normalizedJob),
      'b'.repeat(64),
      canonicalJson(normalizedJob),
    );
  handle.client
    .prepare(
      `INSERT INTO candidate_profiles (id, name, created_at, updated_at)
       VALUES (?, 'Candidate', 1, 1)`,
    )
    .run(profileId);
  handle.client
    .prepare(
      `WITH profile_fixture (id, profile_id, version_no, resume_file_id, agent_run_id, extracted_json,
        effective_json, locked_paths_json, content_hash, is_current, created_at) AS (VALUES (?, ?, 1, NULL, NULL, ?, ?, '[]', ?, 1, 1))
INSERT INTO profile_versions (id,profile_id,version_no,resume_file_id,agent_run_id,content_hash,is_current,created_at,matching_constraints_json,basic_info_json,target_roles_json,intended_roles_json,preferences_json,education_json,work_experience_json,projects_json,works_json,competitions_json,certificates_json,languages_json,professional_skills,self_evaluation,skills_json,domains_json,years_of_experience,management_experience)
SELECT id,profile_id,version_no,resume_file_id,agent_run_id,content_hash,is_current,created_at,COALESCE(json_extract(effective_json,'$.matchingConstraints'),'{}'),COALESCE(json_extract(effective_json,'$.basicInfo'),'{}'),COALESCE(json_extract(effective_json,'$.targetRoles'),'[]'),COALESCE(json_extract(effective_json,'$.intendedRoles'),'[]'),COALESCE(json_extract(effective_json,'$.preferences'),'{}'),COALESCE(json_extract(effective_json,'$.education'),'[]'),COALESCE(json_extract(effective_json,'$.workExperience'),'[]'),COALESCE(json_extract(effective_json,'$.projects'),'[]'),COALESCE(json_extract(effective_json,'$.works'),'[]'),COALESCE(json_extract(effective_json,'$.competitions'),'[]'),COALESCE(json_extract(effective_json,'$.certificates'),'[]'),COALESCE(json_extract(effective_json,'$.languages'),'[]'),json_extract(effective_json,'$.professionalSkills'),json_extract(effective_json,'$.selfEvaluation'),COALESCE(json_extract(effective_json,'$.skills'),'[]'),COALESCE(json_extract(effective_json,'$.domains'),'[]'),json_extract(effective_json,'$.yearsOfExperience'),json_extract(effective_json,'$.managementExperience') FROM profile_fixture`,
    )
    .run(
      profileVersionId,
      profileId,
      canonicalJson(profile),
      canonicalJson(profile),
      'c'.repeat(64),
    );
  return {
    handle,
    clock,
    ids,
    matching: new SqliteMatchingRepository(
      handle.client,
      new SqliteMatchingJobReader(handle.client),
      new SqliteProfileIdentityReader(handle.client),
      new SqliteAgentRunStore(handle.client),
    ),
    profiles: new SqliteCandidateProfileRepository(
      handle.client,
      new SqliteProfileDerivedDataManager(handle.client),
    ),
    context: {
      signal: new AbortController().signal,
      clock,
      logger: silentLogger,
      services: {},
    },
  };
}

describe('matching persistence pipeline', () => {
  it('enqueues one batch atomically and keeps the same task on idempotent submission', async () => {
    const fixture = await setup();
    const registry = new HandlerRegistry();
    registry.register(
      createBatchJobScoreTaskHandler(
        createManualJobScoreTaskHandler({
          understanding: createJobUnderstandingTaskHandler({ unavailable: true }),
          matching: createMatchRevisionTaskHandler(null),
          advice: createJobAdviceTaskHandler({ unavailable: true }),
          adviceEnabled: () => false,
        }),
      ),
    );
    const tasks = new TaskService(
      {
        queue: new SqliteTaskRepository(fixture.handle.client),
        clock: fixture.clock,
        ids: fixture.ids,
      },
      registry,
    );
    const workflow = new MatchWorkflowService({ ...fixture, tasks });
    expect(() =>
      workflow.runForJobs({
        jobIds: [jobId, '018f0000-0000-7000-8000-000000009999'],
        mode: 'rules',
      }),
    ).toThrow();
    expect(tasks.count({ taskType: 'match.score-batch' })).toBe(0);
    const batch = {
      jobIds: [jobId, jobId],
      mode: 'rules' as const,
      idempotencyToken: 'batch-click',
    };
    const result = workflow.runForJobs(batch);
    expect(result).toHaveLength(1);
    expect(result[0]?.task).toMatchObject({
      taskType: 'match.score-batch',
      payload: { jobRevisionIds: [revisionId], profileVersionId },
    });
    expect(workflow.runForJobs(batch)[0]?.task.id).toBe(result[0]?.task.id);
    expect(tasks.count({ taskType: 'match.score-batch' })).toBe(1);
  });
  it('runs only current rules and reuses identical result snapshots', async () => {
    const fixture = await setup();
    const service = new DeterministicMatchingService(fixture);
    service.ensureRuleset();
    const input = { profileVersionId, jobRevisionId: revisionId, jobEnrichmentId: null };
    const result = service.compute(input).match;
    expect(service.compute(input)).toEqual({ match: result, created: false });
    expect(fixture.matching.getMatch(result.id)).toEqual(result);
    expect(service.ensureRuleset().definition).not.toHaveProperty('version');
    expect(service.ensureRuleset().definition).not.toHaveProperty('engine');
  });

  it('pre-filters job revisions by target roles and excluded terms before calculation', async () => {
    const fixture = await setup();

    expect(
      fixture.matching.listLatestRevisionIdsPage({
        afterId: null,
        limit: 10,
        statuses: ['active', 'stale'],
        targetRoles: ['Agent开发'],
      }),
    ).toEqual([revisionId]);
    expect(
      fixture.matching.listLatestRevisionIdsPage({
        afterId: null,
        limit: 10,
        statuses: ['active', 'stale'],
        targetRoles: ['大模型算法'],
      }),
    ).toEqual([]);
    expect(
      fixture.matching.listLatestRevisionIdsPage({
        afterId: null,
        limit: 10,
        statuses: ['active', 'stale'],
        excludedTerms: ['Agent开发'],
      }),
    ).toEqual([]);
  });

  it('runs the complete deterministic path without constructing a model client', async () => {
    const fixture = await setup();
    const service = new DeterministicMatchingService(fixture);
    service.ensureRuleset();
    const handler = createMatchRevisionTaskHandler(
      new MatchingBatchService({ matching: fixture.matching, calculator: service, pageSize: 1 }),
    );

    await expect(
      handler.execute(fixture.context, {
        jobRevisionId: revisionId,
        jobEnrichmentId: null,
        profileVersionId,
      }),
    ).resolves.toMatchObject({ processedInputs: 1, createdResults: 1, existingResults: 0 });
    expect(new CurrentMatchQueryService(fixture.matching).list({ profileId }).items).toMatchObject([
      {
        jobId,
        jobStatus: 'active',
        match: { profileVersionId, jobRevisionId: revisionId, jobEnrichmentId: null },
      },
    ]);
  });

  it('keeps deterministic base results available without any model configuration', async () => {
    const fixture = await setup();
    const service = new DeterministicMatchingService(fixture);
    service.ensureRuleset();
    const first = service.compute({
      profileVersionId,
      jobRevisionId: revisionId,
      jobEnrichmentId: null,
    });
    const replay = service.compute({
      profileVersionId,
      jobRevisionId: revisionId,
      jobEnrichmentId: null,
    });
    expect(first.created).toBe(true);
    expect(replay).toMatchObject({ created: false, match: { id: first.match.id } });
    expect(first.match.filterStatus).toBe('uncertain');
    expect(
      fixture.handle.client
        .prepare(`SELECT count(*) FROM job_metadata WHERE name='match_result'`)
        .pluck()
        .get(),
    ).toBe(1);
  });

  it('regenerates model scores and advice for identical inputs without reusing successful runs', async () => {
    const fixture = await setup();
    const model = new FakeModelClient([
      ...[90, 70].map((fitScore) => (request: ModelRequest) => ({
        kind: 'output' as const,
        output: { ...(understandingOutput(request) as Record<string, unknown>), fitScore },
        usage: { inputTokens: 50, outputTokens: 30, estimatedCostMicros: 10 },
      })),
      ...['准备第一个案例', '准备新的案例'].map((action) => ({
        kind: 'output' as const,
        output: { highlights: [], gaps: [], preparation: [action] },
        usage: { inputTokens: 20, outputTokens: 10, estimatedCostMicros: 5 },
      })),
    ]);
    const runner = new AgentRunner({
      store: new SqliteAgentRunStore(fixture.handle.client),
      model,
      createId: () => fixture.ids.generate(),
      now: () => fixture.clock.now(),
    });
    const understanding = createJobUnderstandingTaskHandler({ ...fixture, runner });
    const service = new DeterministicMatchingService(fixture);
    const payload = { jobRevisionId: revisionId, profileVersionId };
    // 同一任务作用域也不能将已成功运行当作新执行的缓存。
    const context = { ...fixture.context, taskId: 'regenerate-task' };
    const first = await understanding.execute(context, payload);
    const second = await understanding.execute(context, payload);
    expect(first.cacheHit).toBe(false);
    expect(second.cacheHit).toBe(false);
    expect(second.agentRunId).not.toBe(first.agentRunId);
    expect(second.jobEnrichmentId).toBe(first.jobEnrichmentId);
    const firstMatch = service.compute({
      ...payload,
      jobEnrichmentId: parseId(first.jobEnrichmentId, 'JobEnrichment'),
      modelScore: first.fitScore,
    }).match;
    const secondMatch = service.compute({
      ...payload,
      jobEnrichmentId: parseId(second.jobEnrichmentId, 'JobEnrichment'),
      modelScore: second.fitScore,
    }).match;
    expect(secondMatch.id).toBe(firstMatch.id);
    expect(firstMatch.modelScore).toBe(90);
    expect(secondMatch.modelScore).toBe(70);
    const advice = createJobAdviceTaskHandler({ ...fixture, runner });
    const firstAdvice = await advice.execute(context, { matchResultId: secondMatch.id });
    const secondAdvice = await advice.execute(context, { matchResultId: secondMatch.id });
    expect(secondAdvice.cacheHit).toBe(false);
    expect(secondAdvice.agentRunId).not.toBe(firstAdvice.agentRunId);
    expect(secondAdvice.matchAdviceId).toBe(firstAdvice.matchAdviceId);
    expect(model.requests).toHaveLength(4);
    expect(fixture.handle.client.prepare('SELECT count(*) FROM agent_runs').pluck().get()).toBe(4);
  });

  it('persists evidence-validated understanding and replaces the base match with the enriched match', async () => {
    const fixture = await setup();
    const service = new DeterministicMatchingService(fixture);
    service.ensureRuleset();
    const base = service.compute({
      profileVersionId,
      jobRevisionId: revisionId,
      jobEnrichmentId: null,
    });
    const model = new FakeModelClient([
      (request) => ({
        kind: 'output',
        output: understandingOutput(request),
        usage: { inputTokens: 50, outputTokens: 30, estimatedCostMicros: 10 },
      }),
    ]);
    const storedEnrichments: string[] = [];
    const handler = createJobUnderstandingTaskHandler({
      runner: new AgentRunner({
        store: new SqliteAgentRunStore(fixture.handle.client),
        model,
        createId: () => fixture.ids.generate(),
        now: () => fixture.clock.now(),
      }),
      matching: fixture.matching,
      profiles: fixture.profiles,
      clock: fixture.clock,
      ids: fixture.ids,
      onEnrichmentStored: (enrichment) => {
        storedEnrichments.push(enrichment.id);
      },
    });
    const enrichmentResult = await handler.execute(fixture.context, {
      jobRevisionId: revisionId,
      profileVersionId,
    });
    // 2. 理解阶段返回拟合分与理由，事实按职位存储且不含判断字段。
    expect(enrichmentResult.fitScore).toBe(90);
    expect(enrichmentResult.fitReasons).toEqual(['技能与方向高度重合']);
    const currentMatches = new CurrentMatchQueryService(fixture.matching);
    expect(currentMatches.list({ profileId }).items).toMatchObject([
      { match: { id: base.match.id, jobEnrichmentId: null }, jobStatus: 'active' },
    ]);
    const enriched = service.compute({
      profileVersionId,
      jobRevisionId: revisionId,
      jobEnrichmentId: parseId(enrichmentResult.jobEnrichmentId, 'JobEnrichment'),
    });

    expect(storedEnrichments).toEqual([enrichmentResult.jobEnrichmentId]);
    expect(enriched.match.id).toBe(base.match.id);
    expect(enriched.match.inputHash).not.toBe(base.match.inputHash);
    expect(enriched.match.totalScore).toBe(base.match.totalScore);
    // 3. 未传模型分时按规则口径降级，模型分与评分版本随结果持久化。
    expect(enriched.match.modelScore).toBeNull();
    expect(enriched.match).not.toHaveProperty('scoringVersion');
    expect(base.match).not.toHaveProperty('scoringVersion');
    expect(
      fixture.handle.client
        .prepare(`SELECT count(*) FROM job_metadata WHERE name='match_result'`)
        .pluck()
        .get(),
    ).toBe(1);
    expect(
      fixture.handle.client
        .prepare(`SELECT count(*) FROM job_metadata WHERE name='enrichment'`)
        .pluck()
        .get(),
    ).toBe(1);
    expect(currentMatches.list({ profileId }).items).toMatchObject([
      {
        match: { id: enriched.match.id, jobEnrichmentId: enrichmentResult.jobEnrichmentId },
        jobStatus: 'active',
      },
    ]);

    expect(
      enriched.match.components.every((component) => component.matchedEvidence.length === 0),
    ).toBe(true);
    const adviceOutput = {
      highlights: [
        {
          text: 'TypeScript 与 Agent 岗位要求匹配。',
        },
      ],
      gaps: [],
      preparation: ['准备 Agent 架构设计案例。'],
    } as const;
    const adviceModel = new FakeModelClient([
      new ModelClientError('temporary', 'provider unavailable'),
      {
        kind: 'output',
        output: {
          ...adviceOutput,
          highlights: adviceOutput.highlights,
        },
        usage: { inputTokens: 80, outputTokens: 40, estimatedCostMicros: 20 },
      },
    ]);
    const adviceHandler = createJobAdviceTaskHandler({
      runner: new AgentRunner({
        store: new SqliteAgentRunStore(fixture.handle.client),
        model: adviceModel,
        createId: () => fixture.ids.generate(),
        now: () => fixture.clock.now(),
      }),
      matching: fixture.matching,
      profiles: fixture.profiles,
      clock: fixture.clock,
      ids: fixture.ids,
    });
    const advicePayload = {
      matchResultId: enriched.match.id,
    };
    await expect(adviceHandler.execute(fixture.context, advicePayload)).rejects.toMatchObject({
      category: 'network_temporary',
    });
    expect(
      fixture.handle.client
        .prepare(`SELECT count(*) FROM job_metadata WHERE name='match_advice'`)
        .pluck()
        .get(),
    ).toBe(0);
    expect(fixture.matching.getMatch(enriched.match.id)).toEqual(enriched.match);

    const adviceResult = await adviceHandler.execute(fixture.context, advicePayload);
    const adviceQuery = new MatchAdviceQueryService({
      matching: fixture.matching,
      selector: {
        agentKey: jobAdviceAgentDefinition.key,
        definitionHash: agentDefinitionHash(jobAdviceAgentDefinition),
        modelConfigHash: hashCanonical(adviceModel.metadata),
      },
    });
    expect(adviceQuery.current(enriched.match.id)).toMatchObject({
      id: adviceResult.matchAdviceId,
      result: adviceOutput,
    });
    expect(
      new MatchAdviceQueryService({
        matching: fixture.matching,
        selector: {
          agentKey: jobAdviceAgentDefinition.key,
          definitionHash: 'obsolete',
          modelConfigHash: hashCanonical(adviceModel.metadata),
        },
      }).current(enriched.match.id),
    ).toBeNull();

    fixture.handle.client.prepare("UPDATE jobs SET status = 'stale' WHERE id = ?").run(jobId);
    expect(currentMatches.list({ profileId }).items).toEqual([]);
    expect(currentMatches.list({ profileId, includeStale: true }).items).toHaveLength(1);
    fixture.handle.client.prepare("UPDATE jobs SET status = 'closed' WHERE id = ?").run(jobId);
    expect(currentMatches.list({ profileId, includeStale: true }).items).toEqual([]);
    expect(currentMatches.list({ profileId, includeClosed: true }).items).toHaveLength(1);
  });

  it('scores only the explicitly selected profile and job revision', async () => {
    const fixture = await setup();
    const service = new DeterministicMatchingService(fixture);
    service.ensureRuleset();
    const batches = new MatchingBatchService({
      calculator: service,
    });
    const input = {
      jobRevisionId: revisionId,
      jobEnrichmentId: null,
      profileVersionId,
      signal: new AbortController().signal,
    } as const;

    await expect(batches.forRevision(input)).resolves.toMatchObject({
      processedInputs: 1,
      createdResults: 1,
      existingResults: 0,
    });
    await expect(batches.forRevision(input)).resolves.toMatchObject({
      processedInputs: 1,
      createdResults: 0,
      existingResults: 1,
    });

    const controller = new AbortController();
    controller.abort();
    await expect(
      batches.forRevision({ ...input, signal: controller.signal }),
    ).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
  it('stores compact current metadata with stable identity and rejects stale advice and inputs', async () => {
    const fixture = await setup();
    const service = new DeterministicMatchingService(fixture);
    const base = { profileVersionId, jobRevisionId: revisionId, jobEnrichmentId: null };
    const first = service.compute({
      ...base,
      modelScore: 80,
      modelReasons: ['项目经验匹配'],
    }).match;
    const row = fixture.handle.client
      .prepare("SELECT * FROM job_metadata WHERE name='match_result'")
      .get() as { id: string; value: string; created_at: number; updated_at: number };
    const value = JSON.parse(row.value) as {
      model: unknown;
      components: Record<string, unknown>[];
      risk_results: string[];
      unknown_rules: string[];
    };
    expect(value.model).toEqual({ score: 80, reasons: ['项目经验匹配'] });
    expect(
      value.components.every(
        (c: Record<string, unknown>) =>
          Object.keys(c).sort().join(',') === 'dimension,max_score,score',
      ),
    ).toBe(true);
    expect(value.risk_results.every((id: unknown) => typeof id === 'string')).toBe(true);
    expect(value.unknown_rules.every((id: unknown) => typeof id === 'string')).toBe(true);
    expect(row.value).not.toContain('未设置');
    const second = service.compute({ ...base, modelScore: 65, modelReasons: ['经历待补充'] }).match;
    expect(second.id).toBe(first.id);
    expect(second.inputHash).not.toBe(first.inputHash);
    expect(
      fixture.handle.client
        .prepare("SELECT count(*) FROM job_metadata WHERE name='match_result'")
        .pluck()
        .get(),
    ).toBe(1);
    expect(
      fixture.handle.client
        .prepare('SELECT created_at FROM job_metadata WHERE id=?')
        .pluck()
        .get(first.id),
    ).toBe(row.created_at);
    expect(() =>
      fixture.matching.saveAdvice({
        id: parseId(fixture.ids.generate(), 'MatchAdvice'),
        matchResultId: first.id,
        matchInputHash: first.inputHash,
        agentRunId: fixture.ids.generate(),
        schemaVersion: 'test',
        contentHash: contentHash({}),
        result: { highlights: [], gaps: [], preparation: [] },
        createdAt: fixture.clock.now(),
      }),
    ).toThrow('Scoring changed');
    fixture.handle.client
      .prepare('UPDATE profile_versions SET is_current=0 WHERE id=?')
      .run(profileVersionId);
    expect(() => service.compute(base)).toThrow('Profile changed');
    fixture.handle.client
      .prepare('UPDATE profile_versions SET is_current=1 WHERE id=?')
      .run(profileVersionId);
    fixture.handle.client
      .prepare('UPDATE jobs SET content_hash=?,content_id=? WHERE id=?')
      .run('f'.repeat(64), fixture.ids.generate(), jobId);
    expect(fixture.handle.client.prepare('SELECT count(*) FROM job_metadata').pluck().get()).toBe(
      0,
    );
    expect(() => service.compute(base)).toThrow('Job revision does not exist');
    expect(fixture.handle.client.pragma('foreign_key_check')).toEqual([]);
  });
});
