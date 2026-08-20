import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { decideJobMerge, parseId, utcInstant, type NormalizedJob } from '@jobhunter/domain';
import { createTemporaryDataRoot, makeNormalizedJob } from '@jobhunter/testkit';
import { afterEach, describe, expect, it } from 'vitest';
import {
  openSqliteDatabase,
  PersistenceError,
  SqliteArtifactStore,
  SqliteCompanyLookupRepository,
  SqliteJobQueryRepository,
  SqliteSettingsStore,
  SqliteUnitOfWork,
  type SqliteDatabaseHandle,
} from '../src/index.js';

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

async function setup(): Promise<SqliteDatabaseHandle> {
  const root = await createTemporaryDataRoot('jobhunter-repository-');
  const handle = openSqliteDatabase({ dataRoot: root.path });
  resources.push({ root, handle });
  return handle;
}

function seedSync(handle: SqliteDatabaseHandle): void {
  handle.client.exec(`
    INSERT INTO companies
      (id, slug, name, aliases_json, enabled, created_at, updated_at)
    VALUES
      ('018f0000-0000-7000-8000-000000000001', 'fixture', 'Fixture', '[]', 1, 1, 1);
    INSERT INTO job_sources
      (id, company_id, slug, adapter_key, recruitment_type, base_url, config_json,
       sync_policy_version, sync_policy_json, enabled, support_status, health_status,
       created_at, updated_at)
    VALUES
      ('018f0000-0000-7000-8000-000000000002',
       '018f0000-0000-7000-8000-000000000001', 'fixture', 'fixture', 'social',
       'https://example.com', '{}', '1', '{}', 1, 'supported', 'healthy', 1, 1);
    INSERT INTO sync_runs
      (id, source_id, trigger, status, coverage, adapter_version, normalizer_version,
       sync_policy_version, source_config_hash, stats_json, started_at)
    VALUES
      ('018f0000-0000-7000-8000-000000000010',
       '018f0000-0000-7000-8000-000000000002', 'manual', 'running', 'unknown',
       '1', '1', '1', 'hash', '{}', 1);
    INSERT INTO raw_job_records
      (id, source_id, first_sync_run_id, external_job_id, identity_key, source_url,
       content_hash, payload_json, captured_at)
    VALUES
      ('018f0000-0000-7000-8000-000000000011',
       '018f0000-0000-7000-8000-000000000002',
       '018f0000-0000-7000-8000-000000000010', 'fixture-job-1', 'fixture-job-1',
       'https://example.com/job/1', 'raw-hash', '{}', 1);
  `);
}

describe('SqliteUnitOfWork and job repository', () => {
  it('atomically persists a job, revision, observation and first status event', async () => {
    const handle = await setup();
    seedSync(handle);
    const normalized = makeNormalizedJob();
    const decision = decideJobMerge(null, normalized);
    const uow = new SqliteUnitOfWork(handle.client);
    uow.run(({ jobs }) => {
      jobs.persistMutation({
        decision,
        jobId: parseId('018f0000-0000-7000-8000-000000000003', 'Job'),
        revisionId: '018f0000-0000-7000-8000-000000000004',
        statusEventId: '018f0000-0000-7000-8000-000000000005',
        rawRecordId: '018f0000-0000-7000-8000-000000000011',
        normalizerVersion: '1',
        syncRunId: parseId('018f0000-0000-7000-8000-000000000010', 'SyncRun'),
        observedAt: utcInstant(1_700_000_000_000),
      });
    });

    for (const table of ['jobs', 'job_revisions', 'job_observations', 'job_status_events']) {
      expect(handle.client.prepare(`SELECT count(*) FROM ${table}`).pluck().get()).toBe(1);
    }
    const current = uow.run(({ jobs }) =>
      jobs.findCurrent({ sourceId: normalized.sourceId, externalJobId: normalized.externalJobId }),
    );
    expect(current?.normalized).toEqual(normalized);
    expect(current?.revisionNumber).toBe(1);
  });

  it('rolls back the current projection and status event when revision insertion fails', async () => {
    const handle = await setup();
    seedSync(handle);
    const normalized: NormalizedJob = makeNormalizedJob({ externalJobId: 'fixture-job-2' });
    const uow = new SqliteUnitOfWork(handle.client);

    expect(() => {
      uow.run(({ jobs }) => {
        jobs.persistMutation({
          decision: decideJobMerge(null, normalized),
          jobId: parseId('018f0000-0000-7000-8000-000000000020', 'Job'),
          revisionId: '018f0000-0000-7000-8000-000000000021',
          statusEventId: '018f0000-0000-7000-8000-000000000022',
          rawRecordId: 'missing-raw-record',
          normalizerVersion: '1',
          syncRunId: parseId('018f0000-0000-7000-8000-000000000010', 'SyncRun'),
          observedAt: utcInstant(1_700_000_000_000),
        });
      });
    }).toThrow();
    expect(
      handle.client
        .prepare("SELECT count(*) FROM jobs WHERE external_job_id = 'fixture-job-2'")
        .pluck()
        .get(),
    ).toBe(0);
    expect(
      handle.client
        .prepare(
          "SELECT count(*) FROM job_status_events WHERE id = '018f0000-0000-7000-8000-000000000022'",
        )
        .pluck()
        .get(),
    ).toBe(0);
  });

  it('rejects asynchronous work before committing it', async () => {
    const handle = await setup();
    const uow = new SqliteUnitOfWork(handle.client);
    expect(() => uow.run(() => Promise.resolve())).toThrow(/must be synchronous/);
  });
});

describe('SqliteArtifactStore', () => {
  it('writes atomically under the data root and reuses duplicate content', async () => {
    const handle = await setup();
    const store = new SqliteArtifactStore(handle.client, handle.dataRoot);
    const content = new TextEncoder().encode('same content');
    const first = await store.put({
      id: '018f0000-0000-7000-8000-000000000030',
      kind: 'resume',
      mediaType: 'text/plain',
      content,
      createdAt: utcInstant(1),
    });
    const second = await store.put({
      id: '018f0000-0000-7000-8000-000000000031',
      kind: 'resume',
      mediaType: 'text/plain',
      content,
      createdAt: utcInstant(2),
    });
    expect(second.id).toBe(first.id);
    expect(await readFile(store.resolve(first.relativePath), 'utf8')).toBe('same content');
    expect(handle.client.prepare('SELECT count(*) FROM file_artifacts').pluck().get()).toBe(1);
  });

  it('rejects absolute and parent traversal paths', async () => {
    const handle = await setup();
    const store = new SqliteArtifactStore(handle.client, handle.dataRoot);
    expect(() => store.resolve('../outside')).toThrow(PersistenceError);
    expect(() => store.resolve(path.resolve('outside'))).toThrow(PersistenceError);
  });

  it('removes a newly written file when database registration fails', async () => {
    const handle = await setup();
    const store = new SqliteArtifactStore(handle.client, handle.dataRoot);
    const duplicateId = '018f0000-0000-7000-8000-000000000032';
    await store.put({
      id: duplicateId,
      kind: 'resume',
      mediaType: 'text/plain',
      content: new TextEncoder().encode('registered content'),
      createdAt: utcInstant(1),
    });

    const orphanContent = new TextEncoder().encode('must be cleaned up');
    const orphanHash = createHash('sha256').update(orphanContent).digest('hex');
    const orphanPath = store.resolve(
      path.posix.join('artifacts', orphanHash.slice(0, 2), orphanHash),
    );
    await expect(
      store.put({
        id: duplicateId,
        kind: 'resume',
        mediaType: 'text/plain',
        content: orphanContent,
        createdAt: utcInstant(2),
      }),
    ).rejects.toThrow();

    await expect(access(orphanPath)).rejects.toThrow();
    expect(handle.client.prepare('SELECT count(*) FROM file_artifacts').pluck().get()).toBe(1);
  });
});

describe('SqliteSettingsStore', () => {
  it('accepts only allowlisted, schema-valid, non-sensitive settings', async () => {
    const handle = await setup();
    const settings = new SqliteSettingsStore(handle.client);
    settings.set('ui.jobList', { pageSize: 50, sort: 'updated_desc' }, utcInstant(1));
    expect(settings.get('ui.jobList')).toEqual({ pageSize: 50, sort: 'updated_desc' });
    expect(() => {
      settings.set('model.apiKey', { value: 'secret' }, utcInstant(2));
    }).toThrow(/not allowlisted/);
    expect(() => {
      settings.set(
        'ui.jobList',
        { pageSize: 50, sort: 'updated_desc', apiKey: 'secret' },
        utcInstant(2),
      );
    }).toThrow();
  });
});

describe('SqliteJobQueryRepository', () => {
  it('combines FTS and structured filters with stable cursor pagination', async () => {
    const handle = await setup();
    seedSync(handle);
    const insert = handle.client.prepare(
      `INSERT INTO jobs
       (id, company_id, source_id, external_job_id, title, department, job_family,
        locations_json, description, detail_url, apply_url, status, missing_count,
        content_hash, first_seen_at, last_seen_at, created_at, updated_at)
       VALUES (?, '018f0000-0000-7000-8000-000000000001',
               '018f0000-0000-7000-8000-000000000002', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 1, 1, 1, ?)`,
    );
    insert.run(
      '018f0000-0000-7000-8000-000000000040',
      'query-job-1',
      'Agent 开发工程师',
      '大模型平台',
      '研发',
      '["北京"]',
      '建设大模型 Agent 应用',
      'https://example.com/job/1',
      'https://example.com/apply/1',
      'active',
      'hash-1',
      10,
    );
    insert.run(
      '018f0000-0000-7000-8000-000000000041',
      'query-job-2',
      '推荐算法工程师',
      '推荐平台',
      '算法',
      '["上海"]',
      '负责推荐系统',
      'https://example.com/job/2',
      'https://example.com/apply/2',
      'closed',
      'hash-2',
      9,
    );

    const repository = new SqliteJobQueryRepository(handle.client);
    const filtered = repository.query({
      search: '大模型',
      locations: ['北京'],
      statuses: ['active'],
      jobFamilies: ['研发'],
    });
    expect(filtered.items.map((job) => job.id)).toEqual(['018f0000-0000-7000-8000-000000000040']);

    const firstPage = repository.query({ limit: 1 });
    expect(firstPage.items[0]?.id).toBe('018f0000-0000-7000-8000-000000000040');
    expect(firstPage.nextCursor).not.toBeNull();
    if (!firstPage.nextCursor) throw new Error('Expected a cursor for the second page.');
    const secondPage = repository.query({ limit: 1, cursor: firstPage.nextCursor });
    expect(secondPage.items[0]?.id).toBe('018f0000-0000-7000-8000-000000000041');
    expect(secondPage.nextCursor).toBeNull();

    expect(repository.get(parseId('018f0000-0000-7000-8000-000000000040', 'Job'))).toMatchObject({
      companyName: 'Fixture',
      title: 'Agent 开发工程师',
      description: '建设大模型 Agent 应用',
      locations: ['北京'],
    });
    expect(
      new SqliteCompanyLookupRepository(handle.client).findBySelector('fixture'),
    ).toMatchObject({
      id: '018f0000-0000-7000-8000-000000000001',
    });
  });

  it('requires a profile for score filters and returns matching scores', async () => {
    const handle = await setup();
    seedSync(handle);
    const normalized = makeNormalizedJob();
    new SqliteUnitOfWork(handle.client).run(({ jobs }) => {
      jobs.persistMutation({
        decision: decideJobMerge(null, normalized),
        jobId: parseId('018f0000-0000-7000-8000-000000000050', 'Job'),
        revisionId: '018f0000-0000-7000-8000-000000000051',
        statusEventId: '018f0000-0000-7000-8000-000000000052',
        rawRecordId: '018f0000-0000-7000-8000-000000000011',
        normalizerVersion: '1',
        syncRunId: parseId('018f0000-0000-7000-8000-000000000010', 'SyncRun'),
        observedAt: utcInstant(1),
      });
    });
    handle.client.exec(`
      INSERT INTO candidate_profiles (id, name, created_at, updated_at)
      VALUES ('018f0000-0000-7000-8000-000000000053', 'Fixture', 1, 1);
      INSERT INTO profile_versions
        (id, profile_id, version_no, extracted_json, effective_json, locked_paths_json,
         content_hash, is_current, created_at)
      VALUES
        ('018f0000-0000-7000-8000-000000000054',
         '018f0000-0000-7000-8000-000000000053', 1, '{}', '{}', '[]', 'profile-hash', 1, 1);
      INSERT INTO match_rulesets
        (id, version, definition_json, definition_hash, active, created_at)
      VALUES
        ('018f0000-0000-7000-8000-000000000055', '1', '{}', 'rules-hash', 1, 1);
      INSERT INTO match_results
        (id, profile_version_id, job_revision_id, ruleset_id, filter_status, total_score,
         components_json, risks_json, input_hash, created_at)
      VALUES
        ('018f0000-0000-7000-8000-000000000056',
         '018f0000-0000-7000-8000-000000000054',
         '018f0000-0000-7000-8000-000000000051',
         '018f0000-0000-7000-8000-000000000055', 'eligible', 88, '[]', '[]', 'input-hash', 1);
    `);

    const repository = new SqliteJobQueryRepository(handle.client);
    expect(() => repository.query({ minimumScore: 80 })).toThrow(/require profileVersionId/);
    const page = repository.query({
      minimumScore: 80,
      profileVersionId: parseId('018f0000-0000-7000-8000-000000000054', 'ProfileVersion'),
      sort: 'score_desc',
    });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.score).toBe(88);
  });
});
