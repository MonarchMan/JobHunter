import { access, readFile } from 'node:fs/promises';
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

async function openTestDatabase(): Promise<SqliteDatabaseHandle> {
  const dataRoot = await createTemporaryDataRoot('jobhunter-db-');
  dataRoots.push(dataRoot);
  const handle = openSqliteDatabase({ dataRoot: dataRoot.path, busyTimeoutMs: 2_500 });
  handles.push(handle);
  return handle;
}

describe('SQLite migrations and capabilities', () => {
  it('initializes all tables, constraints, WAL, foreign keys and FTS5', async () => {
    const handle = await openTestDatabase();
    const tables = handle.client
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'view') ORDER BY name")
      .all() as { name: string }[];
    const names = tables.map((row) => row.name);
    for (const required of [
      'companies',
      'job_sources',
      'sync_runs',
      'file_artifacts',
      'raw_job_records',
      'jobs',
      'job_revisions',
      'job_observations',
      'job_status_events',
      'resume_documents',
      'candidate_profiles',
      'profile_versions',
      'job_enrichments',
      'match_rulesets',
      'match_results',
      'match_advices',
      'agent_runs',
      'agent_tool_calls',
      'tasks',
      'schedules',
      'application_settings',
      'sync_seen_jobs',
      'jobs_fts',
    ]) {
      expect(names).toContain(required);
    }

    expect(handle.client.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(handle.client.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(handle.client.pragma('busy_timeout', { simple: true })).toBe(2_500);
    await expect(access(handle.databasePath)).resolves.toBeUndefined();
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
      12,
    );
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

  it('keeps FTS synchronized through insert, update and delete triggers', async () => {
    const handle = await openTestDatabase();
    const transaction = handle.client.transaction(() => {
      handle.client
        .prepare(
          `INSERT INTO companies
           (id, slug, name, aliases_json, enabled, created_at, updated_at)
           VALUES ('018f0000-0000-7000-8000-000000000001', 'fixture', 'Fixture', '[]', 1, 1, 1)`,
        )
        .run();
      handle.client
        .prepare(
          `INSERT INTO job_sources
           (id, company_id, slug, adapter_key, recruitment_type, base_url, config_json,
            sync_policy_version, sync_policy_json, enabled, support_status, health_status,
            created_at, updated_at)
           VALUES ('018f0000-0000-7000-8000-000000000002',
                   '018f0000-0000-7000-8000-000000000001', 'fixture', 'fixture', 'social',
                   'https://example.com', '{}', '1', '{}', 1, 'supported', 'healthy', 1, 1)`,
        )
        .run();
      handle.client
        .prepare(
          `INSERT INTO jobs
           (id, company_id, source_id, external_job_id, title, locations_json, description,
            detail_url, apply_url, status, missing_count, content_hash, first_seen_at,
            last_seen_at, created_at, updated_at)
           VALUES ('018f0000-0000-7000-8000-000000000003',
                   '018f0000-0000-7000-8000-000000000001',
                   '018f0000-0000-7000-8000-000000000002', 'job-1', 'Agent 工程师', '[]',
                   '建设大模型应用', 'https://example.com/job/1', 'https://example.com/apply/1',
                   'active', 0, 'hash', 1, 1, 1, 1)`,
        )
        .run();
    });
    transaction();

    expect(
      handle.client
        .prepare("SELECT count(*) FROM jobs_fts WHERE jobs_fts MATCH '大模型'")
        .pluck()
        .get(),
    ).toBe(1);
    handle.client
      .prepare("UPDATE jobs SET description = 'TypeScript 平台' WHERE external_job_id = 'job-1'")
      .run();
    expect(
      handle.client
        .prepare("SELECT count(*) FROM jobs_fts WHERE jobs_fts MATCH '大模型'")
        .pluck()
        .get(),
    ).toBe(0);
    handle.client.prepare("DELETE FROM jobs WHERE external_job_id = 'job-1'").run();
    expect(handle.client.prepare('SELECT count(*) FROM jobs_fts').pluck().get()).toBe(0);
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
