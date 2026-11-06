import { scanTaskProjection } from '@jobhunter/recruitment/persistence/scan-task-sql';
import {
  JobDetailService,
  type JobDetailCommand,
} from '@jobhunter/recruitment/sync/job-detail-service';
import { JobSyncService, type JobSyncResult } from '@jobhunter/recruitment/sync/job-sync-service';
import { sourceJobDetailTaskPayloadSchema } from '@jobhunter/recruitment/sync/job-detail-handler';
import type { SyncTrigger } from '@jobhunter/recruitment/sync-model';
import { parseContentHash, parseId, utcInstant, type UtcInstant } from '@jobhunter/common/domain';
import { parseNormalizedJob } from '@jobhunter/recruitment/domain';
import {
  AdapterRegistry,
  SourceError,
  type DiscoveryEvent,
  type JobSourceAdapter,
  type SourceHttpClient,
} from '@jobhunter/recruitment/source-contracts';
import { createTemporaryDataRoot } from '@jobhunter/common/testing';
import { z } from 'zod';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  openSqliteDatabase,
  type SqliteDatabaseHandle,
} from '@jobhunter/common/persistence/connection';
import { SqliteUnitOfWork } from '@jobhunter/recruitment/persistence/unit-of-work';
import { SqliteWebDiagnosticsRepository } from '@jobhunter/recruitment/persistence/web-diagnostics-repository';

const companyId = parseId('018f0000-0000-7000-8000-000000000001', 'Company');
const sourceId = parseId('018f0000-0000-7000-8000-000000000002', 'JobSource');

/** 构造测试输入或执行断言的辅助逻辑。 */
class TestClock {
  #now = utcInstant(1_000);

  public now(): UtcInstant {
    return this.#now;
  }

  /** 执行测试替身或时钟的操作。 */
  public advance(milliseconds = 1_000): void {
    this.#now = utcInstant(this.#now + milliseconds);
  }
}

/** 构造测试输入或执行断言的辅助逻辑。 */
class SequentialIds {
  #counter = 0x1000;

  public generate(): string {
    const suffix = this.#counter.toString(16).padStart(12, '0');
    this.#counter += 1;
    return `018f0000-0000-7000-8000-${suffix}`;
  }
}

/** 构造测试输入或执行断言的辅助逻辑。 */
interface FixtureJob {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly token?: string;
  readonly failNormalize?: boolean;
  readonly publishedAt?: UtcInstant;
}

/** 构造测试输入或执行断言的辅助逻辑。 */
interface AdapterScenario {
  absenceReliable?: boolean;
  jobs: FixtureJob[];
  coverage: 'complete' | 'partial';
  cursor: string;
  throwAfter: number | null;
  detailFailure: boolean;
  detailFetches: number;
}

/** 构造测试输入或执行断言的辅助逻辑。 */
function fixtureAdapter(
  scenario: AdapterScenario,
  deferredDetails = false,
  requiredDetails = false,
): JobSourceAdapter<Record<string, never>, { readonly description: string }> {
  return {
    metadata: {
      key: 'fixture.sync',
      version: '1.0.0',
      company: { slug: 'fixture', name: 'Fixture' },
      recruitmentType: 'social',
      canonicalEntryUrl: 'https://careers.example.com/jobs',
      officialHosts: ['careers.example.com'],
      capabilities: {
        detail: requiredDetails ? 'required' : deferredDetails ? 'deferred' : 'inline',
        pagination: 'page',
        transport: 'json',
      },
      defaultRateLimit: { requestsPerMinute: 60, burst: 2 },
      externalIdFingerprintVersion: null,
    },
    configSchema: z.object({}).strict(),
    async *discover(): AsyncIterable<DiscoveryEvent> {
      await Promise.resolve();
      let count = 0;
      for (const raw of scenario.jobs) {
        yield {
          type: 'job',
          job: {
            externalJobId: raw.id,
            sourceUrl: `https://careers.example.com/jobs/${raw.id}?utm_source=fixture`,
            raw,
          },
        };
        count += 1;
        if (scenario.throwAfter === count) {
          throw new SourceError('temporary', 'Fixture page failed.');
        }
      }
      yield { type: 'page', page: 1, discoveredCount: count };
      yield {
        type: 'complete',
        coverage: scenario.coverage,
        cursor: scenario.cursor,
        pages: 1,
        discoveredCount: count,
        ...(scenario.absenceReliable === undefined
          ? {}
          : {
              diagnostics: {
                reason: null,
                retryable: false,
                absenceReliable: scenario.absenceReliable,
              },
            }),
      };
    },
    ...(deferredDetails || requiredDetails
      ? {
          fetchDetail(job) {
            scenario.detailFetches += 1;
            if (scenario.detailFailure) {
              return Promise.reject(new SourceError('temporary', 'Fixture detail failed.'));
            }
            return Promise.resolve({ description: `Detailed ${job.externalJobId}.` });
          },
        }
      : {}),
    normalize(input, context) {
      const raw = input.discovered.raw as FixtureJob;
      if (raw.failNormalize) {
        return Promise.reject(new SourceError('parse_changed', 'Fixture normalization failed.'));
      }
      return Promise.resolve({
        job: parseNormalizedJob({
          companyId: context.companyId,
          sourceId: context.sourceId,
          externalJobId: raw.id,
          title: raw.title,
          department: null,
          jobFamily: '研发',
          locations: ['北京'],
          employmentType: '全职',
          experienceText: null,
          educationText: null,
          description: input.detail?.description ?? raw.description,
          detailUrl: `https://careers.example.com/jobs/${raw.id}`,
          applyUrl: `https://careers.example.com/jobs/${raw.id}/apply`,
          publishedAt: raw.publishedAt ?? null,
        }),
        provenance: { title: '$.title', description: '$.description' },
        sourcePrivateJson: {},
      });
    },
    healthCheck: () =>
      Promise.resolve({
        status: 'healthy',
        checkedAt: 1,
        latencyMs: 1,
        signals: [{ key: 'fixture_shape', ok: true, diagnostic: null }],
        errorCategory: null,
      }),
  };
}

const unusedHttp: SourceHttpClient = {
  request: () => Promise.reject(new Error('Fixture adapter does not use HTTP.')),
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

/** 构造测试输入或执行断言的辅助逻辑。 */
interface SyncFixture {
  readonly root: Awaited<ReturnType<typeof createTemporaryDataRoot>>;
  readonly handle: SqliteDatabaseHandle;
  readonly clock: TestClock;
  readonly ids: SequentialIds;
  readonly scenario: AdapterScenario;
  readonly service: JobSyncService;
  readonly uow: SqliteUnitOfWork;
}

/** 构造测试输入或执行断言的辅助逻辑。 */
async function setup(
  options: {
    readonly rejectAllJobs?: boolean;
    readonly deferredDetails?: boolean;
    readonly requiredDetails?: boolean;
  } = {},
): Promise<SyncFixture> {
  const root = await createTemporaryDataRoot('jobhunter-sync-');
  const handle = openSqliteDatabase({ dataRoot: root.path });
  resources.push({ root, handle });
  const policy = {
    staleAfterMisses: 1,
    closeAfterMisses: 2,
    degradedAfterFailures: 1,
    unhealthyAfterFailures: 3,
    enrichNewRevisions: true,
    requestTimeoutMs: 1_000,
  };
  handle.client
    .prepare(
      `INSERT INTO companies
       (id, slug, name, aliases_json, industry, size_tag, enabled, created_at, updated_at)
       VALUES (?, 'fixture', 'Fixture', '[]', NULL, 'large', 1, 1, 1)`,
    )
    .run(companyId);
  const channelId = '018f0000-0000-7000-8200-000000000103';
  handle.client
    .prepare(
      `INSERT INTO source_channels
       (id, company_id, channel, slug, enabled, created_at, updated_at)
       VALUES (?, ?, 'social', 'fixture-social', 1, 1, 1)`,
    )
    .run(channelId, companyId);
  handle.client
    .prepare(
      `INSERT INTO job_sources
       (id, company_id, channel_id, slug, adapter_key, base_url, config_json,
        sync_policy_version, sync_policy_json, enabled, support_status, support_note,
        health_status, consecutive_failures, last_success_at, last_failure_at, created_at, updated_at)
       VALUES (?, ?, ?, 'fixture-social', 'fixture.sync', 'https://careers.example.com/jobs',
               '{}', 'v1', ?, 1, 'supported', NULL, 'unknown', 0, NULL, NULL, 1, 1)`,
    )
    .run(sourceId, companyId, channelId, JSON.stringify(policy));

  const clock = new TestClock();
  const ids = new SequentialIds();
  const scenario: AdapterScenario = {
    jobs: [
      { id: 'job-1', title: 'Agent Engineer', description: 'Build agents.' },
      { id: 'job-2', title: 'LLM Engineer', description: 'Build LLM applications.' },
      { id: 'job-3', title: 'RAG Engineer', description: 'Build retrieval systems.' },
    ],
    coverage: 'complete',
    cursor: 'cursor-1',
    throwAfter: null,
    detailFailure: false,
    detailFetches: 0,
  };
  const registry = new AdapterRegistry();
  registry.register(fixtureAdapter(scenario, options.deferredDetails, options.requiredDetails));
  const uow = new SqliteUnitOfWork(handle.client);
  const service = new JobSyncService({
    uow,
    registry,
    http: unusedHttp,
    clock,
    ids,
    ...(options.rejectAllJobs
      ? {
          jobIntakePolicy: {
            allowedJobFamilies: () => [],
            isReady: () => true,
            accepts: () => false,
          },
        }
      : {}),
    options: {
      normalizerVersion: 'normalize-v1',
    },
  });
  return { root, handle, clock, ids, scenario, service, uow };
}

/** 构造测试输入或执行断言的辅助逻辑。 */
async function run(
  fixture: Awaited<ReturnType<typeof setup>>,
  trigger: SyncTrigger = 'manual',
  signal = new AbortController().signal,
): Promise<JobSyncResult> {
  const result = await fixture.service.run({ sourceId, trigger }, signal);
  fixture.clock.advance();
  return result;
}

/** 构造测试输入或执行断言的辅助逻辑。 */
function count(handle: SqliteDatabaseHandle, table: string): number {
  const allowed = new Set([
    'jobs',
    'jobs',
    'job_observations',
    'tasks',
    'entities',
    'source_job_details',
    'events',
  ]);
  if (!allowed.has(table)) throw new TypeError('Unexpected fixture table.');
  return handle.client
    .prepare(
      `SELECT count(*) FROM ${table}${table === 'tasks' ? " WHERE task_type != 'source.scan'" : ''}`,
    )
    .pluck()
    .get() as number;
}

describe('JobSyncService', () => {
  it('reserves the writer before reading jobs so scheduler writes cannot invalidate the sync snapshot', async () => {
    const fixture = await setup();
    const scheduler = openSqliteDatabase({ dataRoot: fixture.root.path, busyTimeoutMs: 0 });
    let competingWrite: unknown;
    let attempted = false;
    try {
      // 1、在同一短事务的读取与写入之间模拟另一连接提交，稳定重现 WAL 快照升级竞争。
      fixture.uow.run(({ jobs }) => {
        const findCurrent = jobs.findCurrent.bind(jobs);
        vi.spyOn(jobs, 'findCurrent').mockImplementation((identity) => {
          const current = findCurrent(identity);
          if (!attempted) {
            attempted = true;
            try {
              scheduler.client.prepare('UPDATE companies SET updated_at = updated_at + 1').run();
            } catch (error) {
              competingWrite = error;
            }
          }
          return current;
        });
      });
      // 2、业务事务先取得写入权，竞争者退避；同步不应留下半截统计或通用失败。
      expect(await run(fixture)).toMatchObject({
        status: 'succeeded',
        stats: { discovered: 3, created: 3 },
      });
      expect(attempted).toBe(true);
      expect(competingWrite).toMatchObject({ code: 'SQLITE_BUSY' });
      scheduler.client.prepare('UPDATE companies SET updated_at = updated_at + 1').run();
    } finally {
      scheduler.close();
    }
  });

  it('exposes newly created job revision IDs in the completed result only for new content', async () => {
    const fixture = await setup();
    // 1、首次完整同步创建 3 个职位，结果携带全部 3 个新修订职位 ID。
    const first = await run(fixture);
    expect(first).toMatchObject({ status: 'succeeded' });
    if (first.kind !== 'completed') throw new Error('Expected completed run.');
    expect(first.scorableJobIds).toHaveLength(3);
    // 2、相同内容重放不创建新修订，评分范围为空。
    const replay = await run(fixture);
    if (replay.kind !== 'completed') throw new Error('Expected completed run.');
    expect(replay.scorableJobIds).toHaveLength(0);
    // 3、仅一条 JD 变化时，结果只包含该职位的新修订 ID。
    const changed = fixture.scenario.jobs[0];
    if (!changed) throw new Error('Missing fixture job.');
    fixture.scenario.jobs[0] = { ...changed, description: 'Changed requirements.' };
    const revised = await run(fixture);
    if (revised.kind !== 'completed') throw new Error('Expected completed run.');
    expect(revised.scorableJobIds).toHaveLength(1);
    const changedJobId = fixture.handle.client
      .prepare("SELECT id FROM jobs WHERE external_job_id = 'job-1'")
      .pluck()
      .get() as string;
    expect(revised.scorableJobIds).toEqual([changedJobId]);
    // 4、评分阶段消费 scorableJobIds 但不入队新任务，followupEnqueued 保持为 0。
    const stats = fixture.handle.client
      .prepare(`SELECT stats_json FROM ${scanTaskProjection} ORDER BY rowid DESC LIMIT 1`)
      .pluck()
      .get() as string;
    const parsed = JSON.parse(stats) as { followupEnqueued?: number };
    expect(parsed.followupEnqueued).toBe(0);
  });

  it('exposes scorable job IDs for partial runs with completed discoveries', async () => {
    const fixture = await setup();
    fixture.scenario.throwAfter = 1;
    const result = await run(fixture);
    expect(result).toMatchObject({ status: 'partial' });
    // partial 运行已处理 1 条新修订，结果携带该职位 ID 供评分阶段在可靠数据上执行。
    if (result.kind !== 'completed') throw new Error('Expected completed run.');
    expect(result.scorableJobIds).toHaveLength(1);
  });

  it('separates source publication, content changes and observations through lifecycle transitions', async () => {
    const fixture = await setup();
    const original = fixture.scenario.jobs[0];
    if (!original) throw new Error('Missing fixture job');
    fixture.scenario.jobs = [{ ...original, publishedAt: utcInstant(100) }];
    const dates = (): unknown =>
      fixture.handle.client
        .prepare('SELECT updated_at, last_seen_at, published_at, status FROM jobs')
        .get();
    // 1、重复观察只推进 lastSeen，保留真实内容时间及来源发布时间。
    await run(fixture);
    await run(fixture);
    expect(dates()).toEqual({
      updated_at: 1_000,
      last_seen_at: 2_000,
      published_at: 100,
      status: 'active',
    });
    // 2、官网日期变化写入新内容；正文变化不以观察时间冒充发布时间。
    fixture.scenario.jobs = [{ ...original, publishedAt: utcInstant(200) }];
    await run(fixture);
    expect(dates()).toMatchObject({ updated_at: 3_000, published_at: 200 });
    fixture.scenario.jobs = [
      { ...original, description: 'New content.', publishedAt: utcInstant(200) },
    ];
    await run(fixture);
    expect(dates()).toMatchObject({ updated_at: 4_000, published_at: 200 });
    const changed = fixture.scenario.jobs[0];
    if (!changed) throw new Error('Missing changed fixture job');
    // 3、完整缺失、关闭、恢复及可归属解析隔离均不是内容更新。
    fixture.scenario.jobs = [];
    await run(fixture);
    expect(dates()).toMatchObject({ updated_at: 4_000, status: 'stale' });
    await run(fixture);
    expect(dates()).toMatchObject({ updated_at: 4_000, status: 'closed' });
    fixture.scenario.jobs = [changed];
    await run(fixture);
    expect(dates()).toMatchObject({ updated_at: 4_000, last_seen_at: 7_000, status: 'active' });
    fixture.scenario.jobs = [{ ...changed, failNormalize: true }];
    await run(fixture);
    expect(dates()).toEqual({
      updated_at: 4_000,
      last_seen_at: 8_000,
      published_at: 200,
      status: 'active',
    });
  });

  it('retires old content and dependent results atomically', async () => {
    const fixture = await setup();
    const db = fixture.handle.client;
    await run(fixture);
    const old = db
      .prepare('SELECT content_id AS id, id AS job_id FROM jobs ORDER BY content_id LIMIT 1')
      .get() as {
      id: string;
      job_id: string;
    };
    db.exec(`
      INSERT INTO candidate_profiles (id, name, created_at, updated_at) VALUES ('p', 'Fixture', 1, 1);
      WITH profile_input (id, profile_id, version_no, profile_json, content_hash, is_current, created_at) AS (VALUES ('pv', 'p', 1, '{}', 'profile-hash', 1, 1))
INSERT INTO profile_versions (id,profile_id,version_no,content_hash,is_current,created_at,matching_constraints_json,basic_info_json,target_roles_json,intended_roles_json,preferences_json,education_json,work_experience_json,projects_json,works_json,competitions_json,certificates_json,languages_json,professional_skills,self_evaluation,skills_json,domains_json,years_of_experience,management_experience)
SELECT id,profile_id,version_no,content_hash,is_current,created_at,COALESCE(json_extract(profile_json,'$.matchingConstraints'),'{}'),COALESCE(json_extract(profile_json,'$.basicInfo'),'{}'),COALESCE(json_extract(profile_json,'$.targetRoles'),'[]'),COALESCE(json_extract(profile_json,'$.intendedRoles'),'[]'),COALESCE(json_extract(profile_json,'$.preferences'),'{}'),COALESCE(json_extract(profile_json,'$.education'),'[]'),COALESCE(json_extract(profile_json,'$.workExperience'),'[]'),COALESCE(json_extract(profile_json,'$.projects'),'[]'),COALESCE(json_extract(profile_json,'$.works'),'[]'),COALESCE(json_extract(profile_json,'$.competitions'),'[]'),COALESCE(json_extract(profile_json,'$.certificates'),'[]'),COALESCE(json_extract(profile_json,'$.languages'),'[]'),json_extract(profile_json,'$.professionalSkills'),json_extract(profile_json,'$.selfEvaluation'),COALESCE(json_extract(profile_json,'$.skills'),'[]'),COALESCE(json_extract(profile_json,'$.domains'),'[]'),json_extract(profile_json,'$.yearsOfExperience'),json_extract(profile_json,'$.managementExperience') FROM profile_input;

      INSERT INTO agent_runs (id, agent_key, definition_hash, model_config_hash, input_hash, cache_key, status, output_json, started_at)
        VALUES ('agent', 'fixture', 'definition', 'config', 'input', 'cache', 'succeeded', '{}', 1);
    `);
    db.prepare(
      `INSERT INTO job_metadata(id,job_id,name,value,created_at,updated_at) VALUES ( 'enrichment',(SELECT id FROM jobs WHERE content_id=?),'enrichment',json_object('content_id',?,'agent_run_id','agent','schema','1','content_hash','enrichment-hash','result',json('{}')),1,1 )`,
    ).run(old.id, old.id);
    db.prepare(
      `INSERT INTO job_metadata(id,job_id,name,value,created_at,updated_at) VALUES ( 'score',(SELECT id FROM jobs WHERE content_id=?),'match_result',json_object('content_id',?,'profile_version_id','pv','enrichment_id','enrichment','rules_hash','fixture','filter_status','eligible','total_score',80,'input_hash','score-hash','components',json((SELECT json_group_array(json_object('dimension',json_extract(c.value,'$.dimension'),'score',json_extract(c.value,'$.score'),'max_score',json_extract(c.value,'$.maximumScore'))) FROM json_each('[]') c WHERE json_extract(c.value,'$.dimension')!='model')),'risk_results',json((SELECT json_group_array(json_extract(r.value,'$.ruleId')) FROM json_each('[]') r WHERE json_extract(r.value,'$.status')='fail')),'unknown_rules',json((SELECT json_group_array(json_extract(r.value,'$.ruleId')) FROM json_each('[]') r WHERE json_extract(r.value,'$.status')='unknown')),'model',NULL),1,1 )`,
    ).run(old.id, old.id);
    db.exec(
      `INSERT INTO job_metadata(id,job_id,name,value,created_at,updated_at) VALUES ( 'advice',(SELECT job_id FROM job_metadata WHERE id='score'),'match_advice',json_object('match_result_id','score','agent_run_id','agent','schema','1','content_hash','advice-hash','result',json('{}')),1,1 )`,
    );
    for (const [id, type, payload, status] of [
      ['pending-score', 'match.score-job', { jobRevisionId: old.id }, 'pending'],
      ['running-advice', 'match.advise', { matchResultId: 'score' }, 'running'],
    ] as const)
      db.prepare(
        `INSERT INTO tasks (id, task_type, private_state, status, idempotency_key, max_attempts, available_at, created_at)
      VALUES (?, ?, ?, ?, ?, 3, 1, 1)`,
      ).run(id, type, JSON.stringify(payload), status, id);
    // 1、相同内容重放不得删除有效结果。
    await run(fixture);
    expect(
      db.prepare(`SELECT count(*) FROM job_metadata WHERE name='match_result'`).pluck().get(),
    ).toBe(1);
    const first = fixture.scenario.jobs[0];
    if (!first) throw new Error('Missing fixture job');
    fixture.scenario.jobs[0] = { ...first, description: 'Updated requirements' };
    await run(fixture);
    const current = db
      .prepare('SELECT content_id FROM jobs WHERE id = ?')
      .pluck()
      .get(old.job_id) as string;
    expect(
      db.prepare('SELECT content_id AS id, description FROM jobs WHERE id = ?').all(old.job_id),
    ).toEqual([{ id: current, description: 'Updated requirements' }]);
    expect(
      db
        .prepare(`SELECT count(*) FROM job_metadata WHERE name='match_result' AND id = 'score'`)
        .pluck()
        .get(),
    ).toBe(0);
    expect(
      db.prepare(`SELECT count(*) FROM job_metadata WHERE name='match_advice'`).pluck().get(),
    ).toBe(0);
    expect(
      db.prepare(`SELECT count(*) FROM job_metadata WHERE name='enrichment'`).pluck().get(),
    ).toBe(0);
    expect(
      db
        .prepare('SELECT DISTINCT job_id FROM job_observations WHERE job_id = ?')
        .pluck()
        .all(old.job_id),
    ).toEqual([old.job_id]);
    expect(
      db
        .prepare("SELECT status FROM tasks WHERE id IN ('pending-score', 'running-advice')")
        .pluck()
        .all(),
    ).toEqual(['cancelled', 'cancelled']);
    // 3、旧任务即使晚到，也不能把旧内容的评分写回。
    expect(() =>
      db
        .prepare(
          `INSERT INTO job_metadata(id,job_id,name,value,created_at,updated_at) VALUES ( 'late',(SELECT id FROM jobs WHERE content_id=?),'match_result',json_object('content_id',?,'profile_version_id','pv','enrichment_id',NULL,'rules_hash','fixture','filter_status','eligible','total_score',80,'input_hash','late-hash','components',json((SELECT json_group_array(json_object('dimension',json_extract(c.value,'$.dimension'),'score',json_extract(c.value,'$.score'),'max_score',json_extract(c.value,'$.maximumScore'))) FROM json_each('[]') c WHERE json_extract(c.value,'$.dimension')!='model')),'risk_results',json((SELECT json_group_array(json_extract(r.value,'$.ruleId')) FROM json_each('[]') r WHERE json_extract(r.value,'$.status')='fail')),'unknown_rules',json((SELECT json_group_array(json_extract(r.value,'$.ruleId')) FROM json_each('[]') r WHERE json_extract(r.value,'$.status')='unknown')),'model',NULL),3,3 )`,
        )
        .run(old.id, old.id),
    ).toThrow(/NOT NULL/);
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it('reuses validated required details after interruption, including filtered jobs, but expires them', async () => {
    const fixture = await setup({ requiredDetails: true, rejectAllJobs: true });
    fixture.scenario.throwAfter = 2;
    expect(await run(fixture)).toMatchObject({ status: 'partial' });
    expect(fixture.scenario.detailFetches).toBe(2);
    fixture.scenario.throwAfter = null;
    expect(await run(fixture, 'retry')).toMatchObject({
      status: 'succeeded',
      stats: { skippedOutOfScope: 3 },
    });
    expect(fixture.scenario.detailFetches).toBe(3);
    const first = fixture.scenario.jobs[0];
    if (!first) throw new Error('Missing fixture job');
    fixture.scenario.jobs[0] = { ...first, token: 'changed' };
    await run(fixture);
    expect(fixture.scenario.detailFetches).toBe(4);
    fixture.handle.client.prepare("UPDATE source_job_details SET adapter_version = 'old'").run();
    await run(fixture);
    expect(fixture.scenario.detailFetches).toBe(7);
    fixture.clock.advance(6 * 60 * 60_000);
    await run(fixture);
    expect(fixture.scenario.detailFetches).toBe(10);
  });

  it('does not cache invalid required details or record cancellation as an isolated item', async () => {
    const fixture = await setup({ requiredDetails: true });
    const first = fixture.scenario.jobs[0];
    if (!first) throw new Error('Missing fixture job');
    fixture.scenario.jobs[0] = { ...first, failNormalize: true };
    expect(await run(fixture)).toMatchObject({ stats: { isolated: 1 } });
    expect(count(fixture.handle, 'source_job_details')).toBe(2);
    const controller = new AbortController();
    const registry = new AdapterRegistry();
    const adapter = fixtureAdapter(fixture.scenario, false, true);
    registry.register({
      ...adapter,
      fetchDetail: () => {
        controller.abort();
        throw new SourceError('temporary', 'Cancelled fixture');
      },
    });
    const service = new JobSyncService({
      uow: fixture.uow,
      registry,
      http: unusedHttp,
      clock: fixture.clock,
      ids: fixture.ids,
      options: { normalizerVersion: 'normalize-v1' },
    });
    expect(await service.run({ sourceId, trigger: 'retry' }, controller.signal)).toMatchObject({
      status: 'cancelled',
      stats: { isolated: 0 },
    });
  });

  it('persists throttled progress before completion without overwriting a finished run', async () => {
    const fixture = await setup();
    const snapshots: number[] = [];
    const repository = fixture.uow.run(({ sync }) => sync);
    const original = repository.recordProgress.bind(repository);
    const spy = vi.spyOn(repository, 'recordProgress').mockImplementation((runId, stats) => {
      original(runId, stats);
      const row = fixture.handle.client
        .prepare(`SELECT status, stats_json FROM ${scanTaskProjection} WHERE id = ?`)
        .get(runId) as { status: string; stats_json: string };
      expect(row.status).toBe('running');
      snapshots.push((JSON.parse(row.stats_json) as { discovered: number }).discovered);
    });
    const result = await run(fixture);
    expect(snapshots).toEqual([1]);
    spy.mockRestore();
    if (result.kind !== 'completed') throw new Error('Expected completion');
    original(result.runId, { ...result.stats, discovered: 0 });
    const row = fixture.handle.client
      .prepare(`SELECT stats_json FROM ${scanTaskProjection} WHERE id = ?`)
      .pluck()
      .get(result.runId) as string;
    expect(JSON.parse(row)).toMatchObject({ discovered: 3 });
  });

  it('does not enqueue matching or model tasks during synchronization', async () => {
    const fixture = await setup();
    const result = await run(fixture);
    expect(result).toMatchObject({
      status: 'succeeded',
      stats: { discovered: 3, created: 3, followupEnqueued: 0 },
    });
    expect(
      fixture.handle.client
        .prepare("SELECT count(*) FROM tasks WHERE task_type = 'job.enrich'")
        .pluck()
        .get(),
    ).toBe(0);
    expect(
      fixture.handle.client
        .prepare("SELECT count(*) FROM tasks WHERE task_type != 'source.scan'")
        .pluck()
        .get(),
    ).toBe(0);
  });

  it('keeps complete runs healthy when jobs are intentionally filtered out', async () => {
    const fixture = await setup({ rejectAllJobs: true, deferredDetails: true });
    const result = await run(fixture);
    expect(result).toMatchObject({
      status: 'succeeded',
      coverage: 'complete',
      stats: { discovered: 3, skippedOutOfScope: 3, created: 0 },
    });
    expect(
      fixture.handle.client
        .prepare('SELECT health_status, consecutive_failures FROM job_sources WHERE id = ?')
        .get(sourceId),
    ).toMatchObject({ health_status: 'healthy', consecutive_failures: 0 });
    expect(count(fixture.handle, 'tasks')).toBe(0);
  });

  it('defers detail requests and keeps detail failures out of source health', async () => {
    const fixture = await setup({ deferredDetails: true });
    const result = await run(fixture);
    expect(result).toMatchObject({
      status: 'succeeded',
      stats: { created: 3, followupEnqueued: 3 },
    });
    expect(fixture.scenario.detailFetches).toBe(0);
    expect(count(fixture.handle, 'tasks')).toBe(3);

    const rows = fixture.handle.client
      .prepare("SELECT private_state FROM tasks WHERE task_type = 'source.job-detail' ORDER BY id")
      .all() as { readonly private_state: string }[];
    const registry = new AdapterRegistry();
    registry.register(fixtureAdapter(fixture.scenario, true));
    const details = new JobDetailService({
      uow: fixture.uow,
      registry,
      http: unusedHttp,
      clock: fixture.clock,
      ids: fixture.ids,
      normalizerVersion: 'normalize-v1',
    });
    const command = (index: number): JobDetailCommand => {
      const row = rows[index];
      if (!row) throw new Error('Deferred detail task is missing.');
      const payload = sourceJobDetailTaskPayloadSchema.parse(JSON.parse(row.private_state));
      return {
        sourceId: parseId(payload.sourceId, 'JobSource'),
        runId: parseId(payload.runId, 'SyncRun'),
        listContentHash: parseContentHash(payload.listContentHash),
        adapterVersion: payload.adapterVersion,
        discovered: payload.discovered,
      };
    };

    await details.run(command(0), new AbortController().signal);
    expect(count(fixture.handle, 'jobs')).toBe(3);
    expect(count(fixture.handle, 'source_job_details')).toBe(1);
    // 1、详情补全属于内容变化，但不改写列表观察时间或虚构来源发布时间。
    expect(
      fixture.handle.client
        .prepare(
          "SELECT updated_at, last_seen_at, published_at FROM jobs WHERE external_job_id = 'job-1'",
        )
        .get(),
    ).toEqual({ updated_at: 2_000, last_seen_at: 1_000, published_at: null });
    fixture.clock.advance();
    await details.run(command(0), new AbortController().signal);
    expect(
      fixture.handle.client
        .prepare("SELECT updated_at FROM jobs WHERE external_job_id = 'job-1'")
        .pluck()
        .get(),
    ).toBe(2_000);

    fixture.scenario.detailFailure = true;
    await expect(details.run(command(1), new AbortController().signal)).rejects.toMatchObject({
      category: 'temporary',
    });
    expect(
      fixture.handle.client
        .prepare('SELECT health_status, consecutive_failures FROM job_sources WHERE id = ?')
        .get(sourceId),
    ).toMatchObject({ health_status: 'healthy', consecutive_failures: 0 });
    expect(
      fixture.handle.client
        .prepare("SELECT count(*) FROM source_job_details WHERE status = 'failed'")
        .pluck()
        .get(),
    ).toBe(1);
  });

  it('replaces current content and preserves the last successful detail cache', async () => {
    const fixture = await setup({ deferredDetails: true });
    await run(fixture);
    const registry = new AdapterRegistry();
    registry.register(fixtureAdapter(fixture.scenario, true));
    const details = new JobDetailService({
      uow: fixture.uow,
      registry,
      http: unusedHttp,
      clock: fixture.clock,
      ids: fixture.ids,
      normalizerVersion: 'normalize-v1',
    });
    const detailCommand = (): JobDetailCommand => {
      const row = fixture.handle.client
        .prepare(
          `SELECT private_state FROM tasks
           WHERE task_type = 'source.job-detail' AND private_state LIKE '%"externalJobId":"job-1"%'
           ORDER BY created_at DESC LIMIT 1`,
        )
        .get() as { readonly private_state: string } | undefined;
      if (!row) throw new Error('Deferred detail task for job-1 is missing.');
      const payload = sourceJobDetailTaskPayloadSchema.parse(JSON.parse(row.private_state));
      return {
        sourceId: parseId(payload.sourceId, 'JobSource'),
        runId: parseId(payload.runId, 'SyncRun'),
        listContentHash: parseContentHash(payload.listContentHash),
        adapterVersion: payload.adapterVersion,
        discovered: payload.discovered,
      };
    };

    await details.run(detailCommand(), new AbortController().signal);
    expect(count(fixture.handle, 'jobs')).toBe(3);

    fixture.handle.client
      .prepare('DELETE FROM source_job_details WHERE source_id = ? AND external_job_id = ?')
      .run(sourceId, 'job-1');
    const first = fixture.scenario.jobs[0];
    if (!first) throw new Error('Fixture job-1 is missing.');
    fixture.scenario.jobs[0] = { ...first, token: 'new-list-payload' };
    await run(fixture);
    expect(count(fixture.handle, 'jobs')).toBe(3);

    await details.run(detailCommand(), new AbortController().signal);
    expect(count(fixture.handle, 'jobs')).toBe(3);
    expect(
      fixture.handle.client
        .prepare("SELECT status FROM source_job_details WHERE external_job_id = 'job-1'")
        .pluck()
        .get(),
    ).toBe('succeeded');

    fixture.scenario.detailFailure = true;
    await expect(details.run(detailCommand(), new AbortController().signal)).rejects.toMatchObject({
      category: 'temporary',
    });
    expect(
      fixture.handle.client
        .prepare(
          "SELECT status, detail_json FROM source_job_details WHERE external_job_id = 'job-1'",
        )
        .get(),
    ).toMatchObject({ status: 'succeeded' });
  });

  it('streams a first run, replays idempotently and revises only changed content', async () => {
    const fixture = await setup();
    const first = await run(fixture);
    expect(first).toMatchObject({
      kind: 'completed',
      status: 'succeeded',
      coverage: 'complete',
      stats: { discovered: 3, created: 3, followupEnqueued: 0 },
    });
    expect(count(fixture.handle, 'jobs')).toBe(3);
    expect(count(fixture.handle, 'jobs')).toBe(3);
    expect(count(fixture.handle, 'job_observations')).toBe(3);
    expect(count(fixture.handle, 'tasks')).toBe(0);

    const replay = await run(fixture, 'schedule');
    expect(replay).toMatchObject({
      status: 'succeeded',
      stats: { unchanged: 3, created: 0, revised: 0, followupEnqueued: 0 },
    });
    expect(count(fixture.handle, 'jobs')).toBe(3);
    expect(count(fixture.handle, 'job_observations')).toBe(6);
    expect(count(fixture.handle, 'tasks')).toBe(0);

    const changedJob = fixture.scenario.jobs[1];
    if (!changedJob) throw new Error('Changed fixture job is missing.');
    fixture.scenario.jobs[1] = {
      ...changedJob,
      description: 'Build and evaluate production LLM applications.',
    };
    const changed = await run(fixture);
    expect(changed).toMatchObject({
      status: 'succeeded',
      stats: { unchanged: 2, revised: 1, followupEnqueued: 0 },
    });
    expect(count(fixture.handle, 'jobs')).toBe(3);
    expect(count(fixture.handle, 'tasks')).toBe(0);
  });

  it('does not increase missing counts after pagination failure or cancellation', async () => {
    const fixture = await setup();
    await run(fixture);
    fixture.scenario.throwAfter = 2;
    const partial = await run(fixture);
    expect(partial).toMatchObject({ status: 'partial', coverage: 'partial' });
    expect(
      fixture.handle.client
        .prepare("SELECT missing_count FROM jobs WHERE external_job_id = 'job-3'")
        .pluck()
        .get(),
    ).toBe(0);

    fixture.scenario.throwAfter = null;
    fixture.scenario.cursor = 'must-not-commit';
    const abort = new AbortController();
    abort.abort();
    const cancelled = await run(fixture, 'manual', abort.signal);
    expect(cancelled.status).toBe('cancelled');
    const lastCursor = fixture.handle.client
      .prepare(
        `SELECT cursor_out_json FROM ${scanTaskProjection} WHERE status = 'succeeded' ORDER BY finished_at DESC LIMIT 1`,
      )
      .pluck()
      .get();
    expect(lastCursor).not.toContain('must-not-commit');
  });

  it('saves successful deduplicated results without treating uncertain absences as closed jobs', async () => {
    const fixture = await setup();
    await run(fixture);
    fixture.scenario.jobs = fixture.scenario.jobs.slice(0, 2);
    fixture.scenario.absenceReliable = false;
    const result = await run(fixture);
    expect(result).toMatchObject({
      status: 'succeeded',
      coverage: 'complete',
      stats: { discovered: 2, staled: 0, closed: 0 },
    });
    expect(
      fixture.handle.client
        .prepare("SELECT status, missing_count FROM jobs WHERE external_job_id = 'job-3'")
        .get(),
    ).toMatchObject({ status: 'active', missing_count: 0 });
  });

  it('transitions complete-run misses to stale and closed, then restores the job', async () => {
    const fixture = await setup();
    await run(fixture);
    const removed = fixture.scenario.jobs[2];
    if (!removed) throw new Error('Removed fixture job is missing.');
    fixture.scenario.jobs = fixture.scenario.jobs.slice(0, 2);
    const stale = await run(fixture);
    expect(stale.stats).toMatchObject({ staled: 1 });
    expect(
      fixture.handle.client
        .prepare("SELECT status FROM jobs WHERE external_job_id = 'job-3'")
        .pluck()
        .get(),
    ).toBe('stale');

    const closed = await run(fixture);
    expect(closed.stats).toMatchObject({ closed: 1 });
    expect(
      fixture.handle.client
        .prepare("SELECT status FROM jobs WHERE external_job_id = 'job-3'")
        .pluck()
        .get(),
    ).toBe('closed');

    fixture.scenario.jobs.push(removed);
    const restored = await run(fixture);
    expect(restored.stats).toMatchObject({ restored: 1, unchanged: 3 });
    expect(
      fixture.handle.client
        .prepare("SELECT status, missing_count FROM jobs WHERE external_job_id = 'job-3'")
        .get(),
    ).toMatchObject({ status: 'active', missing_count: 0 });
    expect(count(fixture.handle, 'jobs')).toBe(3);
  });

  it('isolates a known normalization failure while preserving observation evidence', async () => {
    const fixture = await setup();
    await run(fixture);
    const failingJob = fixture.scenario.jobs[0];
    if (!failingJob) throw new Error('Failing fixture job is missing.');
    fixture.scenario.jobs[0] = { ...failingJob, failNormalize: true };
    const result = await run(fixture);
    expect(result).toMatchObject({
      status: 'succeeded',
      coverage: 'complete',
      stats: { isolated: 1, unchanged: 2 },
    });
    expect(
      fixture.handle.client
        .prepare("SELECT missing_count, status FROM jobs WHERE external_job_id = 'job-1'")
        .get(),
    ).toMatchObject({ missing_count: 0, status: 'active' });
    expect(count(fixture.handle, 'job_observations')).toBe(6);
    expect(
      fixture.handle.client
        .prepare("SELECT count(*) FROM events WHERE event_type = 'sync.item.failed'")
        .pluck()
        .get(),
    ).toBe(1);
  });

  it('stores only source provenance for a large source payload', async () => {
    const fixture = await setup();
    fixture.scenario.jobs = [
      {
        id: 'job-large',
        title: 'Agent Engineer',
        description: 'x'.repeat(1_000),
        token: 'must-never-be-stored',
      },
    ];
    await run(fixture);
    const row = fixture.handle.client
      .prepare(
        `SELECT source_payload_hash, source_url FROM jobs WHERE external_job_id = 'job-large'`,
      )
      .get() as { readonly source_payload_hash: string; readonly source_url: string };
    expect(row.source_payload_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(row.source_url).toContain('/job-large');
    expect(count(fixture.handle, 'entities')).toBe(0);
  });

  it('exposes complete zero statistics while a sync run is still running', async () => {
    const fixture = await setup();
    const runId = parseId(fixture.ids.generate(), 'SyncRun');
    const startedAt = fixture.clock.now();
    fixture.uow.run(({ sync }) =>
      sync.startRun({
        id: runId,
        sourceId,
        trigger: 'manual',
        coverage: 'unknown',
        adapterVersion: '1.0.0',
        normalizerVersion: 'normalize-v1',
        syncPolicyVersion: 'v1',
        sourceConfigHash: '0'.repeat(64),
        cursorIn: null,
        startedAt,
      }),
    );

    expect(
      new SqliteWebDiagnosticsRepository(fixture.handle.client).getSourceSyncTaskDetail({
        taskId: 'historical-root',
        sourceId,
        trigger: 'manual',
        windowStartedAt: startedAt,
        windowFinishedAt: null,
      })?.run?.stats,
    ).toEqual({
      discovered: 0,
      created: 0,
      revised: 0,
      unchanged: 0,
      skippedNonDomestic: 0,
      skippedOutOfScope: 0,
      skippedUnknownRegion: 0,
      isolated: 0,
      restored: 0,
      staled: 0,
      closed: 0,
      followupEnqueued: 0,
    });

    // 父任务重试会更新执行时间；明确关联的扫描不应因此从诊断中消失。
    fixture.handle.client.exec(`
      INSERT INTO tasks(id,task_type,private_state,status,idempotency_key,attempt_count,max_attempts,available_at,created_at)
      VALUES('retry-parent','source.sync','{}','running','retry-parent',2,3,1,1);
    `);
    fixture.handle.client
      .prepare('UPDATE tasks SET parent_task_id=? WHERE id=?')
      .run('retry-parent', runId);
    const diagnostics = new SqliteWebDiagnosticsRepository(fixture.handle.client);
    expect(
      diagnostics.getSourceSyncTaskDetail({
        taskId: 'retry-parent',
        sourceId,
        trigger: 'manual',
        windowStartedAt: startedAt + 1000,
        windowFinishedAt: null,
      })?.run?.id,
    ).toBe(runId);
    expect(
      diagnostics.getSourceSyncTaskDetail({
        taskId: 'another-parent',
        sourceId,
        trigger: 'manual',
        windowStartedAt: startedAt,
        windowFinishedAt: null,
      })?.run,
    ).toBeNull();
  });

  it('returns the existing run when the source mutex is already held', async () => {
    const fixture = await setup();
    const existingRunId = parseId(fixture.ids.generate(), 'SyncRun');
    fixture.uow.run(({ sync }) =>
      sync.startRun({
        id: existingRunId,
        sourceId,
        trigger: 'manual',
        coverage: 'unknown',
        adapterVersion: '1.0.0',
        normalizerVersion: 'normalize-v1',
        syncPolicyVersion: 'v1',
        sourceConfigHash: '0'.repeat(64),
        cursorIn: null,
        startedAt: fixture.clock.now(),
      }),
    );
    await expect(run(fixture)).resolves.toEqual({ kind: 'conflict', runId: existingRunId });
  });

  it('recovers an orphaned run after the worker lease recovery window', async () => {
    const fixture = await setup();
    const existingRunId = parseId(fixture.ids.generate(), 'SyncRun');
    fixture.uow.run(({ sync }) =>
      sync.startRun({
        id: existingRunId,
        sourceId,
        trigger: 'manual',
        coverage: 'unknown',
        adapterVersion: '1.0.0',
        normalizerVersion: 'normalize-v1',
        syncPolicyVersion: 'v1',
        sourceConfigHash: '0'.repeat(64),
        cursorIn: null,
        startedAt: fixture.clock.now(),
      }),
    );
    fixture.clock.advance(16 * 60_000);

    await expect(run(fixture)).resolves.toMatchObject({ kind: 'completed', status: 'succeeded' });
    expect(
      fixture.handle.client
        .prepare(`SELECT status, error_category FROM ${scanTaskProjection} WHERE id = ?`)
        .get(existingRunId),
    ).toMatchObject({ status: 'cancelled', error_category: 'cancelled' });
  });
});
