import { readFile } from 'node:fs/promises';
import {
  DefaultDerivationTaskFactory,
  JobSyncService,
  type JobSyncResult,
  type SyncTrigger,
} from '@jobhunter/application';
import { parseId, parseNormalizedJob, utcInstant, type UtcInstant } from '@jobhunter/domain';
import {
  AdapterRegistry,
  SourceError,
  type DiscoveryEvent,
  type JobSourceAdapter,
  type SourceHttpClient,
} from '@jobhunter/source-core';
import { createTemporaryDataRoot } from '@jobhunter/testkit';
import { z } from 'zod';
import { afterEach, describe, expect, it } from 'vitest';
import {
  openSqliteDatabase,
  SqliteArtifactStore,
  SqliteUnitOfWork,
  type SqliteDatabaseHandle,
} from '../src/index.js';

const companyId = parseId('018f0000-0000-7000-8000-000000000001', 'Company');
const sourceId = parseId('018f0000-0000-7000-8000-000000000002', 'JobSource');

class TestClock {
  #now = utcInstant(1_000);

  public now(): UtcInstant {
    return this.#now;
  }

  public advance(milliseconds = 1_000): void {
    this.#now = utcInstant(this.#now + milliseconds);
  }
}

class SequentialIds {
  #counter = 0x1000;

  public generate(): string {
    const suffix = this.#counter.toString(16).padStart(12, '0');
    this.#counter += 1;
    return `018f0000-0000-7000-8000-${suffix}`;
  }
}

interface FixtureJob {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly token?: string;
  readonly failNormalize?: boolean;
}

interface AdapterScenario {
  jobs: FixtureJob[];
  coverage: 'complete' | 'partial';
  cursor: string;
  throwAfter: number | null;
}

function fixtureAdapter(scenario: AdapterScenario): JobSourceAdapter<Record<string, never>, never> {
  return {
    metadata: {
      key: 'fixture.sync',
      version: '1.0.0',
      company: { slug: 'fixture', name: 'Fixture' },
      recruitmentType: 'social',
      canonicalEntryUrl: 'https://careers.example.com/jobs',
      officialHosts: ['careers.example.com'],
      capabilities: { detail: 'inline', pagination: 'page', transport: 'json' },
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
      };
    },
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
          description: raw.description,
          detailUrl: `https://careers.example.com/jobs/${raw.id}`,
          applyUrl: `https://careers.example.com/jobs/${raw.id}/apply`,
          publishedAt: null,
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

interface SyncFixture {
  readonly root: Awaited<ReturnType<typeof createTemporaryDataRoot>>;
  readonly handle: SqliteDatabaseHandle;
  readonly clock: TestClock;
  readonly ids: SequentialIds;
  readonly scenario: AdapterScenario;
  readonly service: JobSyncService;
  readonly uow: SqliteUnitOfWork;
}

async function setup(
  options: { readonly maximumInlineRawBytes?: number } = {},
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
  handle.client
    .prepare(
      `INSERT INTO job_sources
       (id, company_id, slug, adapter_key, recruitment_type, base_url, config_json,
        sync_policy_version, sync_policy_json, enabled, support_status, support_note,
        health_status, consecutive_failures, last_success_at, last_failure_at, created_at, updated_at)
       VALUES (?, ?, 'fixture-social', 'fixture.sync', 'social', 'https://careers.example.com/jobs',
               '{}', 'v1', ?, 1, 'supported', NULL, 'unknown', 0, NULL, NULL, 1, 1)`,
    )
    .run(sourceId, companyId, JSON.stringify(policy));

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
  };
  const registry = new AdapterRegistry();
  registry.register(fixtureAdapter(scenario));
  const uow = new SqliteUnitOfWork(handle.client);
  const service = new JobSyncService({
    uow,
    registry,
    artifacts: new SqliteArtifactStore(handle.client, handle.dataRoot),
    http: unusedHttp,
    clock,
    ids,
    derivationTasks: new DefaultDerivationTaskFactory(ids, 'enrich-v1'),
    options: {
      normalizerVersion: 'normalize-v1',
      ...(options.maximumInlineRawBytes === undefined
        ? {}
        : { maximumInlineRawBytes: options.maximumInlineRawBytes }),
    },
  });
  return { root, handle, clock, ids, scenario, service, uow };
}

async function run(
  fixture: Awaited<ReturnType<typeof setup>>,
  trigger: SyncTrigger = 'manual',
  signal = new AbortController().signal,
): Promise<JobSyncResult> {
  const result = await fixture.service.run({ sourceId, trigger }, signal);
  fixture.clock.advance();
  return result;
}

function count(handle: SqliteDatabaseHandle, table: string): number {
  const allowed = new Set([
    'jobs',
    'job_revisions',
    'job_observations',
    'raw_job_records',
    'tasks',
    'file_artifacts',
  ]);
  if (!allowed.has(table)) throw new TypeError('Unexpected fixture table.');
  return handle.client.prepare(`SELECT count(*) FROM ${table}`).pluck().get() as number;
}

describe('JobSyncService', () => {
  it('streams a first run, replays idempotently and revises only changed content', async () => {
    const fixture = await setup();
    const first = await run(fixture);
    expect(first).toMatchObject({
      kind: 'completed',
      status: 'succeeded',
      coverage: 'complete',
      stats: { discovered: 3, created: 3, rawStored: 3, followupEnqueued: 6 },
    });
    expect(count(fixture.handle, 'jobs')).toBe(3);
    expect(count(fixture.handle, 'job_revisions')).toBe(3);
    expect(count(fixture.handle, 'job_observations')).toBe(3);
    expect(count(fixture.handle, 'tasks')).toBe(6);

    const replay = await run(fixture, 'schedule');
    expect(replay).toMatchObject({
      status: 'succeeded',
      stats: { unchanged: 3, created: 0, revised: 0, followupEnqueued: 0 },
    });
    expect(count(fixture.handle, 'job_revisions')).toBe(3);
    expect(count(fixture.handle, 'job_observations')).toBe(6);
    expect(count(fixture.handle, 'tasks')).toBe(6);

    const changedJob = fixture.scenario.jobs[1];
    if (!changedJob) throw new Error('Changed fixture job is missing.');
    fixture.scenario.jobs[1] = {
      ...changedJob,
      description: 'Build and evaluate production LLM applications.',
    };
    const changed = await run(fixture);
    expect(changed).toMatchObject({
      status: 'succeeded',
      stats: { unchanged: 2, revised: 1, followupEnqueued: 2 },
    });
    expect(count(fixture.handle, 'job_revisions')).toBe(4);
    expect(count(fixture.handle, 'tasks')).toBe(8);
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
        "SELECT cursor_out_json FROM sync_runs WHERE status = 'succeeded' ORDER BY finished_at DESC LIMIT 1",
      )
      .pluck()
      .get();
    expect(lastCursor).not.toContain('must-not-commit');
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
    expect(count(fixture.handle, 'job_revisions')).toBe(3);
  });

  it('isolates a known normalization failure while preserving observation evidence', async () => {
    const fixture = await setup();
    await run(fixture);
    const failingJob = fixture.scenario.jobs[0];
    if (!failingJob) throw new Error('Failing fixture job is missing.');
    fixture.scenario.jobs[0] = { ...failingJob, failNormalize: true };
    const result = await run(fixture);
    expect(result).toMatchObject({
      status: 'partial',
      coverage: 'complete',
      stats: { isolated: 1, unchanged: 2 },
    });
    expect(
      fixture.handle.client
        .prepare("SELECT missing_count, status FROM jobs WHERE external_job_id = 'job-1'")
        .get(),
    ).toMatchObject({ missing_count: 0, status: 'active' });
    expect(count(fixture.handle, 'job_observations')).toBe(6);
  });

  it('stores oversized redacted raw evidence as an artifact', async () => {
    const fixture = await setup({ maximumInlineRawBytes: 64 });
    fixture.scenario.jobs = [
      {
        id: 'job-large',
        title: 'Agent Engineer',
        description: 'x'.repeat(1_000),
        token: 'must-never-be-stored',
      },
    ];
    await run(fixture);
    expect(count(fixture.handle, 'file_artifacts')).toBe(1);
    const row = fixture.handle.client
      .prepare(
        `SELECT r.payload_json, f.relative_path FROM raw_job_records r
         JOIN file_artifacts f ON f.id = r.artifact_id WHERE r.external_job_id = 'job-large'`,
      )
      .get() as { readonly payload_json: string | null; readonly relative_path: string };
    expect(row.payload_json).toBeNull();
    const text = await readFile(
      new SqliteArtifactStore(fixture.handle.client, fixture.handle.dataRoot).resolve(
        row.relative_path,
      ),
      'utf8',
    );
    expect(text).not.toContain('must-never-be-stored');
    expect(text).toContain('[redacted]');
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
});
