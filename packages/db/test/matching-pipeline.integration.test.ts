import {
  AgentRunner,
  hashCanonical,
  ModelClientError,
  type ModelRequest,
} from '@jobhunter/agent-core';
import {
  CurrentMatchQueryService,
  DeterministicMatchingService,
  MatchAdviceQueryService,
  MatchingBatchService,
  createJobAdviceTaskHandler,
  createJobUnderstandingTaskHandler,
  createMatchRevisionTaskHandler,
  type TaskHandlerContext,
  type TaskLogger,
} from '@jobhunter/application';
import {
  canonicalJson,
  normalizedJobContentHash,
  parseCandidateProfile,
  parseId,
  parseNormalizedJob,
  utcInstant,
  type Clock,
  type IdGenerator,
  type UtcInstant,
} from '@jobhunter/domain';
import { FakeModelClient } from '@jobhunter/llm';
import { jobAdviceAgentDefinition } from '@jobhunter/matching';
import { createTemporaryDataRoot } from '@jobhunter/testkit';
import { afterEach, describe, expect, it } from 'vitest';
import {
  openSqliteDatabase,
  SqliteAgentRunStore,
  SqliteCandidateProfileRepository,
  SqliteMatchingRepository,
  type SqliteDatabaseHandle,
} from '../src/index.js';

class AdvancingClock implements Clock {
  #value = 1_800_000_000_000;

  public now(): UtcInstant {
    this.#value += 1;
    return utcInstant(this.#value);
  }
}

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
const rulesetId = parseId('018f0000-0000-7000-8000-00000000d005', 'MatchRuleset');

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
  expect(request.input).toEqual({
    title: normalizedJob.title,
    description: normalizedJob.description,
    experienceText: normalizedJob.experienceText,
    educationText: normalizedJob.educationText,
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
      `INSERT INTO sync_runs
       (id, source_id, trigger, status, coverage, adapter_version, normalizer_version,
        sync_policy_version, source_config_hash, stats_json, started_at, finished_at)
       VALUES ('sync-match', ?, 'manual', 'succeeded', 'complete', '1', '1', 'v1', ?, '{}', 1, 2)`,
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
      `INSERT INTO job_revisions
       (id, job_id, revision_no, content_hash, normalizer_version, source_payload_hash,
        source_url, snapshot_json, change_set_json, created_at)
       VALUES (?, ?, 1, ?, '1', ?, 'https://careers.example.com/jobs/agent-job', ?, '[]', 1)`,
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
      `INSERT INTO profile_versions
       (id, profile_id, version_no, resume_file_id, agent_run_id, extracted_json,
        effective_json, locked_paths_json, content_hash, is_current, created_at)
       VALUES (?, ?, 1, NULL, NULL, ?, ?, '[]', ?, 1, 1)`,
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
    matching: new SqliteMatchingRepository(handle.client),
    profiles: new SqliteCandidateProfileRepository(handle.client),
    context: {
      signal: new AbortController().signal,
      clock,
      logger: silentLogger,
      services: {},
    },
  };
}

describe('matching persistence pipeline', () => {
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
    service.ensureRulesetV1({ id: rulesetId });
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
    service.ensureRulesetV1({ id: rulesetId });
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
    expect(fixture.handle.client.prepare('SELECT count(*) FROM match_results').pluck().get()).toBe(
      1,
    );
  });

  it('persists evidence-validated understanding and retains base and enriched matches', async () => {
    const fixture = await setup();
    const service = new DeterministicMatchingService(fixture);
    service.ensureRulesetV1({ id: rulesetId });
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
      clock: fixture.clock,
      ids: fixture.ids,
      onEnrichmentStored: (enrichment) => {
        storedEnrichments.push(enrichment.id);
      },
    });
    const enrichmentResult = await handler.execute(fixture.context, {
      jobRevisionId: revisionId,
      enrichmentVersion: '1.0.0',
    });
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
    expect(enriched.match.id).not.toBe(base.match.id);
    expect(enriched.match.inputHash).not.toBe(base.match.inputHash);
    expect(enriched.match.totalScore).toBe(100);
    expect(fixture.handle.client.prepare('SELECT count(*) FROM match_results').pluck().get()).toBe(
      2,
    );
    expect(
      fixture.handle.client.prepare('SELECT count(*) FROM job_enrichments').pluck().get(),
    ).toBe(1);
    expect(currentMatches.list({ profileId }).items).toMatchObject([
      {
        match: { id: enriched.match.id, jobEnrichmentId: enrichmentResult.jobEnrichmentId },
        jobStatus: 'active',
        rulesetVersion: 'v1',
      },
    ]);

    const evidence = enriched.match.components.flatMap((component) => component.matchedEvidence)[0];
    if (!evidence) throw new Error('Expected enriched match evidence.');
    const adviceOutput = {
      highlights: [
        {
          text: 'TypeScript 与 Agent 岗位要求匹配。',
          references: [{ kind: 'evidence', value: evidence.summary }],
        },
      ],
      gaps: [],
      uncertainties: [],
      resumeEmphasis: ['突出简历中已有的 TypeScript Agent 项目。'],
      preparation: ['准备 Agent 架构设计案例。'],
    } as const;
    const adviceModel = new FakeModelClient([
      new ModelClientError('temporary', 'provider unavailable'),
      {
        kind: 'output',
        output: adviceOutput,
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
      adviceVersion: jobAdviceAgentDefinition.version,
    };
    await expect(adviceHandler.execute(fixture.context, advicePayload)).rejects.toMatchObject({
      category: 'network_temporary',
    });
    expect(fixture.handle.client.prepare('SELECT count(*) FROM match_advices').pluck().get()).toBe(
      0,
    );
    expect(fixture.matching.getMatch(enriched.match.id)).toEqual(enriched.match);

    const adviceResult = await adviceHandler.execute(fixture.context, advicePayload);
    const adviceQuery = new MatchAdviceQueryService({
      matching: fixture.matching,
      selector: {
        agentKey: jobAdviceAgentDefinition.key,
        agentVersion: jobAdviceAgentDefinition.version,
        promptVersion: jobAdviceAgentDefinition.promptVersion,
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
          agentVersion: jobAdviceAgentDefinition.version,
          promptVersion: 'obsolete',
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
    service.ensureRulesetV1({ id: rulesetId });
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
});
