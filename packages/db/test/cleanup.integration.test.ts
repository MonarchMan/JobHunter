import { CleanupService } from '@jobhunter/application';
import { createTemporaryDataRoot } from '@jobhunter/testkit';
import { mkdir, readFile, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DataRootCleanupFileStore,
  openSqliteDatabase,
  SqliteCleanupRepository,
} from '../src/index.js';

const dayMs = 24 * 60 * 60 * 1_000;

describe('cleanup infrastructure', () => {
  it('deletes only confirmed old candidates and keeps young files and runs', async () => {
    const root = await createTemporaryDataRoot('jobhunter-cleanup-');
    const handle = openSqliteDatabase({ dataRoot: root.path });
    const now = Date.now();
    try {
      handle.client
        .prepare(
          `INSERT INTO agent_runs
           (id, agent_key, agent_version, prompt_version, model_config_hash, input_hash,
            cache_key, status, output_json, error_category, error_summary, input_tokens,
            output_tokens, estimated_cost_micros, cost_currency, pricing_version,
            started_at, finished_at)
           VALUES (?, 'fixture', '1', '1', ?, ?, ?, ?, NULL, NULL, NULL,
                   NULL, NULL, NULL, NULL, NULL, ?, ?)`,
        )
        .run('old-failed', 'a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64), 'failed', 1, 2);
      handle.client
        .prepare(
          `INSERT INTO agent_runs
           (id, agent_key, agent_version, prompt_version, model_config_hash, input_hash,
            cache_key, status, output_json, error_category, error_summary, input_tokens,
            output_tokens, estimated_cost_micros, cost_currency, pricing_version,
            started_at, finished_at)
           VALUES (?, 'fixture', '1', '1', ?, ?, ?, 'failed', NULL, NULL, NULL,
                   NULL, NULL, NULL, NULL, NULL, ?, ?)`,
        )
        .run('young-failed', 'd'.repeat(64), 'e'.repeat(64), 'f'.repeat(64), now, now);
      const artifactDirectory = path.join(root.path, 'artifacts', 'fixture');
      await mkdir(artifactDirectory, { recursive: true });
      const oldFile = path.join(artifactDirectory, 'old');
      const youngFile = path.join(artifactDirectory, 'young');
      await writeFile(oldFile, 'old');
      await writeFile(youngFile, 'young');
      await utimes(oldFile, new Date(now - 2 * dayMs), new Date(now - 2 * dayMs));

      const files = new DataRootCleanupFileStore(root.path);
      const service = new CleanupService({
        repository: new SqliteCleanupRepository(handle.client),
        files,
      });
      const plan = await service.plan(
        { sourceDetailsDays: 30, observationsDays: 90, failedAgentRunsDays: 30 },
        { now },
      );
      expect(plan.candidates).toMatchObject([
        { kind: 'agent_run', id: 'old-failed' },
        { kind: 'orphan_file', relativePath: 'artifacts/fixture/old' },
      ]);

      await service.execute(plan.confirmationToken, { now: now + 1 });
      expect(handle.client.prepare('SELECT id FROM agent_runs ORDER BY id').pluck().all()).toEqual([
        'young-failed',
      ]);
      await expect(readFile(youngFile, 'utf8')).resolves.toBe('young');
      await expect(readFile(oldFile, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(files.remove(['../outside'])).rejects.toThrow(/artifact root/);
    } finally {
      handle.close();
      await root.cleanup();
    }
  });

  it('removes expired observations and source detail cache entries independently', async () => {
    const root = await createTemporaryDataRoot('jobhunter-cleanup-records-');
    const handle = openSqliteDatabase({ dataRoot: root.path });
    try {
      handle.client.exec(`
        INSERT INTO companies
          (id, slug, name, aliases_json, industry, size_tag, enabled, created_at, updated_at)
        VALUES ('company', 'cleanup', 'Cleanup', '[]', NULL, NULL, 1, 1, 1);
        INSERT INTO source_channels
          (id, company_id, channel, slug, enabled, created_at, updated_at)
        VALUES ('channel', 'company', 'social', 'cleanup-social', 1, 1, 1);
        INSERT INTO job_sources
          (id, company_id, channel_id, slug, adapter_key, base_url, config_json,
           sync_policy_version, sync_policy_json, enabled, support_status, health_status,
           consecutive_failures, created_at, updated_at)
        VALUES ('source', 'company', 'channel', 'cleanup-social', 'cleanup.fixture',
                'https://careers.example.com', '{}', 'v1', '{}', 1, 'supported',
                'healthy', 0, 1, 1);
        INSERT INTO sync_runs
          (id, source_id, trigger, status, coverage, adapter_version, normalizer_version,
           sync_policy_version, source_config_hash, stats_json, started_at, finished_at)
        VALUES ('sync', 'source', 'manual', 'succeeded', 'complete', '1', '1', 'v1',
                '${'a'.repeat(64)}', '{}', 1, 2);
        INSERT INTO jobs
          (id, company_id, source_id, external_job_id, title, department, job_family,
           locations_json, employment_type, experience_text, education_text, description,
           detail_url, apply_url, published_at, status, missing_count, content_hash,
           first_seen_at, last_seen_at, closed_at, created_at, updated_at)
        VALUES ('job', 'company', 'source', 'job', 'Fixture', NULL, NULL, '[]', NULL,
                NULL, NULL, 'Fixture', 'https://careers.example.com/job',
                'https://careers.example.com/job', NULL, 'active', 0, '${'c'.repeat(64)}',
                1, 1, NULL, 1, 1);
        INSERT INTO job_revisions
          (id, job_id, revision_no, content_hash, normalizer_version, source_payload_hash,
           source_url, snapshot_json, change_set_json, created_at)
        VALUES ('revision', 'job', 1, '${'c'.repeat(64)}', '1', '${'b'.repeat(64)}',
                'https://careers.example.com/job', '{}', '[]', 1);
        INSERT INTO job_observations (job_id, sync_run_id, job_revision_id, observed_at)
        VALUES ('job', 'sync', 'revision', 1);
        INSERT INTO source_job_details
          (source_id, external_job_id, list_content_hash, adapter_version, detail_json,
           status, fetched_at, updated_at)
        VALUES ('source', 'job', '${'c'.repeat(64)}', '1', '{}', 'succeeded', 1, 1);
      `);
      const repository = new SqliteCleanupRepository(handle.client);
      const cutoffs = { sourceDetailsBefore: 10, observationsBefore: 10, agentRunsBefore: 10 };
      const first = repository.listCandidates(cutoffs);
      expect(first).toEqual([
        expect.objectContaining({ kind: 'observation' }),
        expect.objectContaining({ kind: 'source_detail', relativePath: null, bytes: 0 }),
      ]);
      repository.deleteCandidates(first);
      expect(handle.client.prepare('SELECT count(*) FROM job_observations').pluck().get()).toBe(0);
      expect(handle.client.prepare('SELECT count(*) FROM source_job_details').pluck().get()).toBe(
        0,
      );
      expect(handle.client.prepare('SELECT count(*) FROM job_revisions').pluck().get()).toBe(1);
    } finally {
      handle.close();
      await root.cleanup();
    }
  });
});
