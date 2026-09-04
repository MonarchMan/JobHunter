import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createTemporaryDataRoot } from '@jobhunter/testkit';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { openSqliteDatabase, type SqliteDatabaseHandle } from '../src/index.js';

const dataRoots: Awaited<ReturnType<typeof createTemporaryDataRoot>>[] = [];
const handles: SqliteDatabaseHandle[] = [];

afterEach(async () => {
  for (const handle of handles.splice(0)) handle.close();
  await Promise.all(dataRoots.splice(0).map((root) => root.cleanup()));
});

/** 构造测试输入或执行断言的辅助逻辑。 */
async function openTestDatabase(): Promise<SqliteDatabaseHandle> {
  const dataRoot = await createTemporaryDataRoot('jobhunter-db-');
  dataRoots.push(dataRoot);
  const handle = openSqliteDatabase({ dataRoot: dataRoot.path, busyTimeoutMs: 2_500 });
  handles.push(handle);
  return handle;
}

/** 构造测试输入或执行断言的辅助逻辑。 */
async function migrationsBefore(
  root: string,
  directoryName: string,
  firstExcludedIndex: number,
): Promise<string> {
  const folder = path.join(root, directoryName);
  const metadataFolder = path.join(folder, 'meta');
  await mkdir(metadataFolder, { recursive: true });
  const journal = JSON.parse(
    await readFile(new URL('../migrations/meta/_journal.json', import.meta.url), 'utf8'),
  ) as {
    readonly version: string;
    readonly dialect: string;
    readonly entries: readonly { readonly idx: number; readonly tag: string }[];
  };
  const entries = journal.entries.filter((entry) => entry.idx < firstExcludedIndex);
  await Promise.all(
    entries.map((entry) =>
      copyFile(
        new URL(`../migrations/${entry.tag}.sql`, import.meta.url),
        path.join(folder, `${entry.tag}.sql`),
      ),
    ),
  );
  await writeFile(
    path.join(metadataFolder, '_journal.json'),
    JSON.stringify({ ...journal, entries }, null, 2),
  );
  return folder;
}

describe('SQLite migrations and capabilities', () => {
  it('initializes the compact final schema with constraints, WAL and foreign keys', async () => {
    const handle = await openTestDatabase();
    const tables = handle.client
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'view') ORDER BY name")
      .all() as { name: string }[];
    const names = tables.map((row) => row.name);
    for (const required of [
      'companies',
      'source_channels',
      'job_sources',
      'sync_runs',
      'files',
      'entities',
      'file_entity_mappings',
      'source_job_details',
      'events',
      'jobs',
      'job_revisions',
      'job_observations',
      'candidate_profiles',
      'agent_runs',
      'profile_versions',
      'job_enrichments',
      'match_rulesets',
      'match_results',
      'match_advices',
      'schedules',
      'tasks',
      'application_settings',
      'resume_project_snapshots',
      'project_dossiers',
      'drill_sessions',
      'drill_turns',
      'drill_answer_revisions',
      'project_knowledge_items',
      'drill_coverage',
      'interview_experiences',
      'interview_question_entries',
      'sync_seen_jobs',
    ]) {
      expect(names).toContain(required);
    }
    for (const removed of [
      'file_artifacts',
      'raw_job_records',
      'job_status_events',
      'resume_documents',
      'experience_documents',
      'resume_polish_suggestions',
      'agent_tool_calls',
      'sync_item_failures',
      'operation_audit_events',
    ]) {
      expect(names).not.toContain(removed);
    }
    expect(names.some((name) => name.startsWith('jobs_fts'))).toBe(false);

    expect(handle.client.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(handle.client.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(handle.client.pragma('busy_timeout', { simple: true })).toBe(2_500);
    await expect(access(handle.databasePath)).resolves.toBeUndefined();

    const insertMaterialFile = handle.client.prepare(
      `INSERT INTO files
       (id, kind, name, state, revision, properties_json, created_at, updated_at)
       VALUES (?, 'project_material', 'architecture.md', 'pending', 0, ?, 1, 1)`,
    );
    const logicalIdentity = JSON.stringify({
      dossierId: '018f0000-0000-7000-8000-000000000080',
      fileName: 'architecture.md',
    });
    insertMaterialFile.run('018f0000-0000-7000-8000-000000000081', logicalIdentity);
    expect(() =>
      insertMaterialFile.run('018f0000-0000-7000-8000-000000000082', logicalIdentity),
    ).toThrow(/unique/iu);
  });

  it('runs a migration only once and preserves existing data', async () => {
    const first = await openTestDatabase();
    first.client
      .prepare(
        `INSERT INTO companies
         (id, slug, name, aliases_json, enabled, created_at, updated_at)
         VALUES (?, ?, ?, '[]', 1, 1, 1)`,
      )
      .run('018f0000-0000-7000-8000-000000000001', 'fixture', 'Fixture');
    const dataRoot = first.dataRoot;
    first.close();
    handles.splice(handles.indexOf(first), 1);

    const reopened = openSqliteDatabase({ dataRoot });
    handles.push(reopened);
    expect(
      reopened.client.prepare('SELECT name FROM companies WHERE slug = ?').pluck().get('fixture'),
    ).toBe('Fixture');
    expect(reopened.client.prepare('SELECT count(*) FROM __drizzle_migrations').pluck().get()).toBe(
      32,
    );
  });

  it('destructively resets legacy cleanup schedule payloads to current defaults', async () => {
    const dataRoot = await createTemporaryDataRoot('jobhunter-db-cleanup-schedule-upgrade-');
    dataRoots.push(dataRoot);
    const legacyMigrations = await migrationsBefore(
      dataRoot.path,
      'migrations-before-cleanup-schedule-reset',
      24,
    );
    const legacy = openSqliteDatabase({
      dataRoot: dataRoot.path,
      migrationsFolder: legacyMigrations,
    });
    handles.push(legacy);
    legacy.client
      .prepare(
        `INSERT INTO schedules
         (id, schedule_key, task_type, payload_json, cron_expression, timezone, enabled,
          next_run_at, last_enqueued_at, created_at, updated_at)
         VALUES (?, 'maintenance.cleanup:weekly', 'maintenance.cleanup', ?, '0 4 * * 0',
                 'Asia/Shanghai', 1, 1, NULL, 1, 1)`,
      )
      .run(
        '018f0000-0000-7000-8000-000000000401',
        JSON.stringify({ rawRecordsDays: 7, observationsDays: 8, failedAgentRunsDays: 9 }),
      );
    legacy.close();
    handles.splice(handles.indexOf(legacy), 1);

    const upgraded = openSqliteDatabase({ dataRoot: dataRoot.path });
    handles.push(upgraded);
    const payload = upgraded.client
      .prepare(
        "SELECT payload_json FROM schedules WHERE schedule_key = 'maintenance.cleanup:weekly'",
      )
      .pluck()
      .get() as string;
    expect(JSON.parse(payload)).toEqual({
      sourceDetailsDays: 30,
      observationsDays: 90,
      failedAgentRunsDays: 30,
    });
  });

  it('destructively projects legacy sync run statistics to the current shape', async () => {
    const dataRoot = await createTemporaryDataRoot('jobhunter-db-sync-stats-upgrade-');
    dataRoots.push(dataRoot);
    const legacyMigrations = await migrationsBefore(
      dataRoot.path,
      'migrations-before-sync-stats-reset',
      25,
    );
    const legacy = openSqliteDatabase({
      dataRoot: dataRoot.path,
      migrationsFolder: legacyMigrations,
    });
    handles.push(legacy);
    legacy.client.exec(`
      INSERT INTO companies
        (id, slug, name, aliases_json, enabled, created_at, updated_at)
      VALUES ('stats-company', 'stats-company', 'Stats Company', '[]', 1, 1, 1);
      INSERT INTO source_channels
        (id, company_id, channel, slug, enabled, created_at, updated_at)
      VALUES ('stats-channel', 'stats-company', 'social', 'stats-company-social', 1, 1, 1);
      INSERT INTO job_sources
        (id, company_id, channel_id, slug, adapter_key, base_url, config_json,
         sync_policy_version, sync_policy_json, enabled, support_status, health_status,
         consecutive_failures, created_at, updated_at)
      VALUES ('stats-source', 'stats-company', 'stats-channel', 'stats-source', 'stats.source',
              'https://example.com', '{}', 'v1', '{}', 1, 'supported', 'healthy', 0, 1, 1);
      INSERT INTO sync_runs
        (id, source_id, trigger, status, coverage, adapter_version, normalizer_version,
         sync_policy_version, source_config_hash, stats_json, started_at)
      VALUES ('stats-run', 'stats-source', 'manual', 'running', 'unknown', 'v1', 'v1',
              'v1', '${'0'.repeat(64)}', '{}', 1),
             ('stats-run-legacy', 'stats-source', 'manual', 'succeeded', 'complete', 'v1', 'v1',
              'v1', '${'1'.repeat(64)}',
              '{"discovered":3,"created":1,"unchanged":2,"rawStored":3}', 2);
    `);
    legacy.close();
    handles.splice(handles.indexOf(legacy), 1);

    const upgraded = openSqliteDatabase({ dataRoot: dataRoot.path });
    handles.push(upgraded);
    const payload = upgraded.client
      .prepare("SELECT stats_json FROM sync_runs WHERE id = 'stats-run'")
      .pluck()
      .get() as string;
    expect(JSON.parse(payload)).toEqual({
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
    const legacyPayload = upgraded.client
      .prepare("SELECT stats_json FROM sync_runs WHERE id = 'stats-run-legacy'")
      .pluck()
      .get() as string;
    expect(JSON.parse(legacyPayload)).toEqual({
      discovered: 3,
      created: 1,
      revised: 0,
      unchanged: 2,
      skippedNonDomestic: 0,
      skippedOutOfScope: 0,
      skippedUnknownRegion: 0,
      isolated: 0,
      restored: 0,
      staled: 0,
      closed: 0,
      followupEnqueued: 0,
    });
  });

  it('retains the latest five profile versions and removes obsolete match derivations', async () => {
    const dataRoot = await createTemporaryDataRoot('jobhunter-db-profile-retention-upgrade-');
    dataRoots.push(dataRoot);
    const legacyMigrations = await migrationsBefore(
      dataRoot.path,
      'migrations-before-profile-retention',
      27,
    );
    const legacy = openSqliteDatabase({
      dataRoot: dataRoot.path,
      migrationsFolder: legacyMigrations,
    });
    handles.push(legacy);
    legacy.client.exec(`
      INSERT INTO candidate_profiles (id, name, created_at, updated_at)
      VALUES ('retention-profile', 'Candidate', 1, 7);
      INSERT INTO profile_versions
        (id, profile_id, version_no, extracted_json, effective_json, locked_paths_json,
         content_hash, is_current, created_at)
      VALUES
        ('retention-version-1', 'retention-profile', 1, '{}', '{}', '[]', 'hash-1', 0, 1),
        ('retention-version-2', 'retention-profile', 2, '{}', '{}', '[]', 'hash-2', 0, 2),
        ('retention-version-3', 'retention-profile', 3, '{}', '{}', '[]', 'hash-3', 0, 3),
        ('retention-version-4', 'retention-profile', 4, '{}', '{}', '[]', 'hash-4', 0, 4),
        ('retention-version-5', 'retention-profile', 5, '{}', '{}', '[]', 'hash-5', 0, 5),
        ('retention-version-6', 'retention-profile', 6, '{}', '{}', '[]', 'hash-6', 0, 6),
        ('retention-version-7', 'retention-profile', 7, '{}', '{}', '[]', 'hash-7', 1, 7);
      INSERT INTO companies
        (id, slug, name, aliases_json, enabled, created_at, updated_at)
      VALUES ('retention-company', 'retention-company', 'Company', '[]', 1, 1, 1);
      INSERT INTO source_channels
        (id, company_id, channel, slug, enabled, created_at, updated_at)
      VALUES ('retention-channel', 'retention-company', 'social', 'retention-channel', 1, 1, 1);
      INSERT INTO job_sources
        (id, company_id, channel_id, slug, adapter_key, coverage_role, base_url, config_json,
         sync_policy_version, sync_policy_json, enabled, support_status, health_status,
         consecutive_failures, created_at, updated_at)
      VALUES ('retention-source', 'retention-company', 'retention-channel', 'retention-source',
              'retention.source', 'required', 'https://example.com', '{}', 'v1', '{}', 1,
              'supported', 'healthy', 0, 1, 1);
      INSERT INTO jobs
        (id, company_id, source_id, external_job_id, title, locations_json, description,
         detail_url, apply_url, status, missing_count, content_hash, first_seen_at, last_seen_at,
         created_at, updated_at)
      VALUES ('retention-job', 'retention-company', 'retention-source', 'job', 'Engineer', '[]',
              'Build systems', 'https://example.com/job', 'https://example.com/job', 'active', 0,
              'job-hash', 1, 1, 1, 1);
      INSERT INTO job_revisions
        (id, job_id, revision_no, content_hash, normalizer_version, source_payload_hash,
         source_url, snapshot_json, change_set_json, created_at)
      VALUES ('retention-revision', 'retention-job', 1, 'revision-hash', 'v1',
              '${'a'.repeat(64)}', 'https://example.com/job', '{}', '[]', 1);
      INSERT INTO match_rulesets
        (id, version, definition_json, definition_hash, active, created_at)
      VALUES ('retention-ruleset', 'retention-v1', '{}', 'retention-rules-hash', 1, 1);
      INSERT INTO match_results
        (id, profile_version_id, job_revision_id, ruleset_id, filter_status, total_score,
         components_json, risks_json, input_hash, created_at)
      VALUES ('retention-match', 'retention-version-1', 'retention-revision',
              'retention-ruleset', 'eligible', 80, '[]', '[]', 'retention-input-hash', 1);
    `);
    legacy.close();
    handles.splice(handles.indexOf(legacy), 1);

    const upgraded = openSqliteDatabase({ dataRoot: dataRoot.path });
    handles.push(upgraded);
    expect(
      upgraded.client
        .prepare(
          `SELECT version_no FROM profile_versions
           WHERE profile_id = 'retention-profile' ORDER BY version_no DESC`,
        )
        .pluck()
        .all(),
    ).toEqual([7, 6, 5, 4, 3]);
    expect(
      upgraded.client
        .prepare("SELECT count(*) FROM match_results WHERE id = 'retention-match'")
        .pluck()
        .get(),
    ).toBe(0);
  });

  it('migrates existing sync work to one active recruitment channel', async () => {
    const handle = await openTestDatabase();
    const companyId = '018f0000-0000-7000-8000-000000000901';
    const internChannelId = '018f0000-0000-7000-8200-000000010901';
    const socialChannelId = '018f0000-0000-7000-8200-000000010903';
    const internSourceId = '018f0000-0000-7000-8000-000000000901';
    const socialSourceId = '018f0000-0000-7000-8000-000000000903';
    handle.client
      .prepare(
        `INSERT INTO companies
         (id, slug, name, aliases_json, enabled, created_at, updated_at)
         VALUES (?, 'single-channel-fixture', 'Single channel fixture', '[]', 1, 1, 1)`,
      )
      .run(companyId);
    const insertChannel = handle.client.prepare(
      `INSERT INTO source_channels
       (id, company_id, channel, slug, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, 1, 1)`,
    );
    insertChannel.run(internChannelId, companyId, 'intern', 'single-channel-fixture-intern');
    insertChannel.run(socialChannelId, companyId, 'social', 'single-channel-fixture-social');
    const insertSource = handle.client.prepare(
      `INSERT INTO job_sources
       (id, company_id, channel_id, slug, adapter_key, coverage_role, base_url,
        config_json, sync_policy_version, sync_policy_json, enabled,
        support_status, health_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'required', 'https://example.com', '{}', 'v1', '{}', 1,
               'supported', 'unknown', 1, 1)`,
    );
    insertSource.run(
      internSourceId,
      companyId,
      internChannelId,
      'single-channel-fixture-intern',
      'fixture.intern',
    );
    insertSource.run(
      socialSourceId,
      companyId,
      socialChannelId,
      'single-channel-fixture-social',
      'fixture.social',
    );
    const insertSchedule = handle.client.prepare(
      `INSERT INTO schedules
       (id, schedule_key, task_type, payload_json, cron_expression, timezone, enabled,
        next_run_at, created_at, updated_at)
       VALUES (?, ?, 'source.sync', ?, '0 9 * * *', 'Asia/Shanghai', 1, 1, 1, 1)`,
    );
    insertSchedule.run(
      'schedule-intern',
      `source.sync:${internSourceId}`,
      JSON.stringify({ sourceId: internSourceId, trigger: 'schedule' }),
    );
    insertSchedule.run(
      'schedule-social',
      `source.sync:${socialSourceId}`,
      JSON.stringify({ sourceId: socialSourceId, trigger: 'schedule' }),
    );
    const insertTask = handle.client.prepare(
      `INSERT INTO tasks
       (id, task_type, payload_json, status, idempotency_key, max_attempts,
        available_at, created_at)
       VALUES (?, 'source.sync', ?, 'pending', ?, 3, 1, 1)`,
    );
    insertTask.run(
      'task-intern',
      JSON.stringify({ sourceId: internSourceId, trigger: 'manual' }),
      'task-intern',
    );
    insertTask.run(
      'task-social',
      JSON.stringify({ sourceId: socialSourceId, trigger: 'manual' }),
      'task-social',
    );

    const migration = await readFile(
      new URL('../migrations/0016_single_active_source_channel.sql', import.meta.url),
      'utf8',
    );
    handle.client
      .prepare("DELETE FROM application_settings WHERE key = 'sources.activeChannel'")
      .run();
    for (const statement of migration.split('--> statement-breakpoint')) {
      if (statement.trim()) handle.client.exec(statement);
    }

    expect(
      handle.client
        .prepare("SELECT value_json FROM application_settings WHERE key = 'sources.activeChannel'")
        .pluck()
        .get(),
    ).toBe('{"channel":"intern"}');
    expect(
      handle.client
        .prepare(
          `SELECT channel, enabled FROM source_channels
           WHERE company_id = ? ORDER BY channel`,
        )
        .all(companyId),
    ).toEqual([
      { channel: 'intern', enabled: 1 },
      { channel: 'social', enabled: 0 },
    ]);
    expect(handle.client.prepare('SELECT id, enabled FROM schedules ORDER BY id').all()).toEqual([
      { id: 'schedule-intern', enabled: 1 },
      { id: 'schedule-social', enabled: 0 },
    ]);
    expect(handle.client.prepare('SELECT id, status FROM tasks ORDER BY id').all()).toEqual([
      { id: 'task-intern', status: 'pending' },
      { id: 'task-social', status: 'cancelled' },
    ]);
  });

  it('upgrades the minimal previous-schema fixture without losing its data', async () => {
    const dataRoot = await createTemporaryDataRoot('jobhunter-db-upgrade-');
    dataRoots.push(dataRoot);
    const databasePath = path.join(dataRoot.path, 'jobhunter.sqlite');
    const previous = new Database(databasePath);
    try {
      previous.exec(await readFile(new URL('./fixtures/schema-v0.sql', import.meta.url), 'utf8'));
    } finally {
      previous.close();
    }

    const upgraded = openSqliteDatabase({ dataRoot: dataRoot.path });
    handles.push(upgraded);
    expect(
      upgraded.client
        .prepare("SELECT value FROM legacy_metadata WHERE key = 'fixture'")
        .pluck()
        .get(),
    ).toBe('preserved');
    expect(
      upgraded.client
        .prepare("SELECT count(*) FROM sqlite_master WHERE name = 'jobs'")
        .pluck()
        .get(),
    ).toBe(1);
  });

  it('converges an existing 0018 database without losing business files or job provenance', async () => {
    const dataRoot = await createTemporaryDataRoot('jobhunter-db-storage-upgrade-');
    dataRoots.push(dataRoot);
    const legacyMigrations = await migrationsBefore(
      dataRoot.path,
      'migrations-before-storage-convergence',
      19,
    );
    const legacy = openSqliteDatabase({
      dataRoot: dataRoot.path,
      migrationsFolder: legacyMigrations,
    });
    handles.push(legacy);
    legacy.client.exec(`
      INSERT INTO file_artifacts
        (id, kind, relative_path, media_type, sha256, byte_size, created_at)
      VALUES
        ('resume-artifact', 'resume', 'artifacts/resume', 'text/plain', '${'a'.repeat(64)}', 6, 1),
        ('experience-artifact', 'export', 'artifacts/experience', 'text/plain', '${'b'.repeat(64)}', 10, 2);
      INSERT INTO resume_documents
        (id, artifact_id, content_hash, media_type, extracted_text, parse_status,
         parser_version, created_at)
      VALUES ('resume-file', 'resume-artifact', '${'a'.repeat(64)}', 'text/plain',
              'resume', 'parsed', 'text@1', 1);
      INSERT INTO candidate_profiles (id, name, created_at, updated_at)
      VALUES ('profile', 'Candidate', 1, 1);
      INSERT INTO profile_versions
        (id, profile_id, version_no, resume_document_id, extracted_json, effective_json,
         locked_paths_json, content_hash, is_current, created_at)
      VALUES ('profile-version', 'profile', 1, 'resume-file', '{}', '{}', '[]',
              '${'c'.repeat(64)}', 1, 1);
      INSERT INTO experience_documents
        (id, artifact_id, content_hash, file_name, media_type, source_mode, extracted_text,
         normalized_text, parser_version, template_version, status, warnings_json, revision,
         created_at, updated_at)
      VALUES ('experience-file', 'experience-artifact', '${'b'.repeat(64)}', 'experience.txt',
              'text/plain', 'upload', 'question answer', 'question answer', 'experience@1',
              'personal-experience@v1', 'accepted', '[]', 1, 2, 3);
      INSERT INTO interview_experiences
        (id, document_id, sequence_no, company, role, tags_json)
      VALUES ('experience', 'experience-file', 1, 'Example', 'Engineer', '[]');
      INSERT INTO interview_question_entries
        (id, experience_id, sequence_no, question, answer)
      VALUES ('question', 'experience', 1, 'Why?', 'Because.');

      INSERT INTO companies
        (id, slug, name, aliases_json, enabled, created_at, updated_at)
      VALUES ('company', 'upgrade-company', 'Upgrade Company', '[]', 1, 1, 1);
      INSERT INTO source_channels
        (id, company_id, channel, slug, enabled, created_at, updated_at)
      VALUES ('channel', 'company', 'social', 'upgrade-company-social', 1, 1, 1);
      INSERT INTO job_sources
        (id, company_id, channel_id, slug, adapter_key, coverage_role, recruitment_type,
         base_url, config_json, sync_policy_version, sync_policy_json, enabled, support_status,
         health_status, consecutive_failures, created_at, updated_at)
      VALUES ('source', 'company', 'channel', 'upgrade-source', 'upgrade.source', 'required',
              'social', 'https://example.com', '{}', 'v1', '{}', 1, 'supported', 'healthy',
              0, 1, 1);
      INSERT INTO sync_runs
        (id, source_id, trigger, status, coverage, adapter_version, normalizer_version,
         sync_policy_version, source_config_hash, stats_json, started_at, finished_at)
      VALUES ('sync', 'source', 'manual', 'succeeded', 'complete', '1', '1', 'v1',
              '${'d'.repeat(64)}', '{}', 1, 2);
      INSERT INTO raw_job_records
        (id, source_id, first_sync_run_id, external_job_id, identity_key, source_url,
         content_hash, payload_json, captured_at)
      VALUES ('raw', 'source', 'sync', 'external-job', 'external-job',
              'https://example.com/jobs/external-job', '${'e'.repeat(64)}', '{"private":true}', 1);
      INSERT INTO jobs
        (id, company_id, source_id, external_job_id, title, locations_json, description,
         detail_url, apply_url, status, missing_count, content_hash, first_seen_at, last_seen_at,
         created_at, updated_at)
      VALUES ('job', 'company', 'source', 'external-job', 'Engineer', '[]', 'Build systems',
              'https://example.com/jobs/external-job', 'https://example.com/jobs/external-job',
              'active', 0, '${'f'.repeat(64)}', 1, 1, 1, 1);
      INSERT INTO job_revisions
        (id, job_id, revision_no, content_hash, normalizer_version, snapshot_json,
         change_set_json, raw_record_id, created_at)
      VALUES ('revision', 'job', 1, '${'f'.repeat(64)}', '1', '{}', '[]', 'raw', 1);
      INSERT INTO job_observations (job_id, sync_run_id, raw_record_id, observed_at)
      VALUES ('job', 'sync', 'raw', 1);
      INSERT INTO job_status_events
        (id, job_id, sync_run_id, from_status, to_status, reason_code, evidence_json, created_at)
      VALUES ('status-event', 'job', 'sync', NULL, 'active', 'discovered',
              '{"rawRecordId":"raw","kept":true}', 1);
    `);
    legacy.close();
    handles.splice(handles.indexOf(legacy), 1);

    const upgraded = openSqliteDatabase({ dataRoot: dataRoot.path });
    handles.push(upgraded);
    expect(upgraded.client.prepare('SELECT id, kind, state FROM files ORDER BY id').all()).toEqual([
      { id: 'experience-file', kind: 'interview_experience', state: 'accepted' },
      { id: 'resume-file', kind: 'resume', state: 'parsed' },
    ]);
    expect(
      upgraded.client
        .prepare(
          `SELECT file_id, entity_id, parser_version, parse_status
           FROM file_entity_mappings ORDER BY file_id`,
        )
        .all(),
    ).toEqual([
      {
        file_id: 'experience-file',
        entity_id: 'experience-artifact',
        parser_version: 'experience@1',
        parse_status: 'parsed',
      },
      {
        file_id: 'resume-file',
        entity_id: 'resume-artifact',
        parser_version: 'text@1',
        parse_status: 'parsed',
      },
    ]);
    expect(
      upgraded.client
        .prepare('SELECT resume_file_id FROM profile_versions WHERE id = ?')
        .pluck()
        .get('profile-version'),
    ).toBe('resume-file');
    expect(
      upgraded.client
        .prepare(
          `SELECT file_id, source_type, review_status, research_request_id, verification_status
           FROM interview_experiences WHERE id = ?`,
        )
        .get('experience'),
    ).toEqual({
      file_id: 'experience-file',
      source_type: 'personal',
      review_status: 'accepted',
      research_request_id: null,
      verification_status: 'not_applicable',
    });
    expect(
      upgraded.client
        .prepare(
          `SELECT answer, answer_excerpt, topics_json, question_fingerprint
           FROM interview_question_entries WHERE id = ?`,
        )
        .get('question'),
    ).toEqual({
      answer: 'Because.',
      answer_excerpt: null,
      topics_json: '[]',
      question_fingerprint: null,
    });
    expect(
      (
        upgraded.client.prepare("PRAGMA table_info('interview_question_entries')").all() as {
          readonly name: string;
        }[]
      ).some((column) => column.name === 'evidence_excerpt'),
    ).toBe(false);
    expect(
      upgraded.client
        .prepare(`SELECT source_payload_hash, source_url FROM job_revisions WHERE id = 'revision'`)
        .get(),
    ).toEqual({
      source_payload_hash: 'e'.repeat(64),
      source_url: 'https://example.com/jobs/external-job',
    });
    expect(
      upgraded.client
        .prepare('SELECT job_revision_id FROM job_observations WHERE job_id = ?')
        .pluck()
        .get('job'),
    ).toBe('revision');
    const eventPayload = upgraded.client
      .prepare("SELECT payload_json FROM events WHERE event_type = 'job.status.changed'")
      .pluck()
      .get() as string;
    expect(JSON.parse(eventPayload)).toMatchObject({ evidence: { kept: true } });
    expect(eventPayload).not.toContain('rawRecordId');
    expect(
      upgraded.client
        .prepare(
          `SELECT count(*) FROM sqlite_master
           WHERE name IN ('raw_job_records', 'file_artifacts', 'resume_documents',
                          'experience_documents', 'jobs_fts')`,
        )
        .pluck()
        .get(),
    ).toBe(0);
    expect(upgraded.client.pragma('foreign_key_check')).toEqual([]);
  });

  it('uses the logical channel as the only recruitment classification', async () => {
    const handle = await openTestDatabase();
    const columns = handle.client.pragma('table_info(job_sources)') as { name: string }[];
    expect(columns.map((column) => column.name)).not.toContain('recruitment_type');
    handle.client.exec(`
      INSERT INTO companies
        (id, slug, name, aliases_json, enabled, created_at, updated_at)
      VALUES ('classification-company', 'classification-company', 'Classification', '[]', 1, 1, 1);
      INSERT INTO source_channels
        (id, company_id, channel, slug, enabled, created_at, updated_at)
      VALUES ('classification-channel', 'classification-company', 'intern',
              'classification-company-intern', 1, 1, 1);
      INSERT INTO job_sources
        (id, company_id, channel_id, slug, adapter_key, base_url, config_json,
         sync_policy_version, sync_policy_json, enabled, support_status, health_status,
         consecutive_failures, created_at, updated_at)
      VALUES ('classification-source', 'classification-company', 'classification-channel',
              'classification-source', 'classification.source', 'https://example.com', '{}',
              'v1', '{}', 1, 'supported', 'unknown', 0, 1, 1);
    `);
    expect(
      handle.client
        .prepare(
          `SELECT channel.channel
           FROM job_sources source
           JOIN source_channels channel ON channel.id = source.channel_id
           WHERE source.id = 'classification-source'`,
        )
        .pluck()
        .get(),
    ).toBe('intern');
  });

  it('adds logical channels without rewriting physical source history', async () => {
    const database = new Database(':memory:');
    try {
      database.pragma('foreign_keys = ON');
      database.exec(`
        CREATE TABLE companies (
          id text PRIMARY KEY, slug text NOT NULL UNIQUE, name text NOT NULL, enabled integer NOT NULL
        );
        CREATE TABLE job_sources (
          id text PRIMARY KEY, company_id text NOT NULL REFERENCES companies(id),
          slug text NOT NULL UNIQUE, adapter_key text NOT NULL, recruitment_type text NOT NULL,
          base_url text NOT NULL, support_status text NOT NULL, support_note text
        );
        CREATE TABLE sync_runs (
          id text PRIMARY KEY, source_id text NOT NULL REFERENCES job_sources(id)
        );
        CREATE TABLE jobs (
          id text PRIMARY KEY, source_id text NOT NULL REFERENCES job_sources(id)
        );
        CREATE TABLE tasks (id text PRIMARY KEY, payload_json text NOT NULL);
        INSERT INTO companies VALUES (
          '018f0000-0000-7000-8000-000000000101', 'tencent', '腾讯', 1
        );
        INSERT INTO job_sources VALUES (
          '018f0000-0000-7000-8000-000000000201',
          '018f0000-0000-7000-8000-000000000101',
          'tencent-social', 'tencent.social', 'social',
          'https://careers.tencent.com', 'supported', NULL
        );
        INSERT INTO sync_runs VALUES ('run-1', '018f0000-0000-7000-8000-000000000201');
        INSERT INTO jobs VALUES ('job-1', '018f0000-0000-7000-8000-000000000201');
        INSERT INTO tasks VALUES (
          'task-1', '{"sourceId":"018f0000-0000-7000-8000-000000000201"}'
        );
      `);
      const migration = await readFile(
        new URL('../migrations/0015_logical_source_channels.sql', import.meta.url),
        'utf8',
      );
      for (const statement of migration.split('--> statement-breakpoint')) {
        if (statement.trim()) database.exec(statement);
      }

      expect(
        database.prepare('SELECT id, channel_id, coverage_role FROM job_sources').get(),
      ).toEqual({
        id: '018f0000-0000-7000-8000-000000000201',
        channel_id: '018f0000-0000-7000-8200-000000010103',
        coverage_role: 'required',
      });
      expect(database.prepare('SELECT source_id FROM sync_runs').pluck().get()).toBe(
        '018f0000-0000-7000-8000-000000000201',
      );
      expect(database.prepare('SELECT source_id FROM jobs').pluck().get()).toBe(
        '018f0000-0000-7000-8000-000000000201',
      );
      expect(database.prepare('SELECT payload_json FROM tasks').pluck().get()).toBe(
        '{"sourceId":"018f0000-0000-7000-8000-000000000201"}',
      );
      expect(database.pragma('foreign_key_check')).toEqual([]);
      expect(() =>
        database
          .prepare(
            `INSERT INTO job_sources
             (id, company_id, channel_id, slug, adapter_key, recruitment_type,
              base_url, support_status)
             VALUES ('invalid', '018f0000-0000-7000-8000-000000000101', NULL,
                     'invalid', 'invalid', 'social', 'https://example.com', 'blocked')`,
          )
          .run(),
      ).toThrow();
    } finally {
      database.close();
    }
  });

  it('does not create FTS tables or synchronization triggers', async () => {
    const handle = await openTestDatabase();
    expect(
      handle.client
        .prepare(
          `SELECT count(*) FROM sqlite_master
           WHERE name LIKE 'jobs_fts%' OR name LIKE 'jobs_a%' OR name LIKE 'jobs_d%'`,
        )
        .pluck()
        .get(),
    ).toBe(0);
  });

  it('rolls back a failed transaction without partial rows', async () => {
    const handle = await openTestDatabase();
    const transaction = handle.client.transaction(() => {
      handle.client
        .prepare(
          `INSERT INTO companies
           (id, slug, name, aliases_json, enabled, created_at, updated_at)
           VALUES ('018f0000-0000-7000-8000-000000000001', 'rollback', 'Rollback', '[]', 1, 1, 1)`,
        )
        .run();
      handle.client.prepare('INSERT INTO companies (id) VALUES (?)').run('invalid-row');
    });

    expect(transaction).toThrow();
    expect(
      handle.client.prepare("SELECT count(*) FROM companies WHERE slug = 'rollback'").pluck().get(),
    ).toBe(0);
  });

  it('applies busy_timeout when a second writer is blocked', async () => {
    const first = await openTestDatabase();
    const second = openSqliteDatabase({ dataRoot: first.dataRoot, busyTimeoutMs: 100 });
    handles.push(second);
    first.client.exec('BEGIN IMMEDIATE');
    const started = performance.now();
    try {
      expect(() => {
        second.client
          .prepare(
            `INSERT INTO companies
             (id, slug, name, aliases_json, enabled, created_at, updated_at)
             VALUES ('018f0000-0000-7000-8000-000000000070', 'busy', 'Busy', '[]', 1, 1, 1)`,
          )
          .run();
      }).toThrow(/locked|busy/i);
      expect(performance.now() - started).toBeGreaterThanOrEqual(75);
    } finally {
      first.client.exec('ROLLBACK');
    }
  });

  it('uses only the configured temporary data root', async () => {
    const handle = await openTestDatabase();
    expect(path.resolve(handle.dataRoot)).not.toBe(path.resolve('var'));
    expect(path.dirname(handle.databasePath)).toBe(path.resolve(handle.dataRoot));
  });
});
