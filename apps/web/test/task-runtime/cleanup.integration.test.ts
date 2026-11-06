import { SqliteRecruitmentCleanupParticipant } from '@jobhunter/recruitment/persistence/cleanup-participant';
import { SqliteUserAgentReferenceReader } from '@jobhunter/user/persistence/agent-reference-reader';
import { SqliteProfileDerivedDataManager } from '@jobhunter/matching/persistence/profile-derived-data-manager';
import { CleanupService } from '@jobhunter/common/operations/cleanup-service';
import { createTemporaryDataRoot } from '@jobhunter/common/testing';
import { mkdir, readFile, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DataRootCleanupFileStore,
  SqliteCleanupRepository,
} from '@jobhunter/common/persistence/cleanup';
import { openSqliteDatabase } from '@jobhunter/common/persistence/connection';

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
           (id, agent_key, definition_hash, model_config_hash, input_hash,
            cache_key, status, output_json, error_category, error_summary, input_tokens,
            output_tokens, estimated_cost_micros, cost_currency, pricing_version,
            started_at, finished_at)
           VALUES (?, 'fixture', 'definition', ?, ?, ?, ?, NULL, NULL, NULL,
                   NULL, NULL, NULL, NULL, NULL, ?, ?)`,
        )
        .run('old-failed', 'a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64), 'failed', 1, 2);
      handle.client
        .prepare(
          `INSERT INTO agent_runs
           (id, agent_key, definition_hash, model_config_hash, input_hash,
            cache_key, status, output_json, error_category, error_summary, input_tokens,
            output_tokens, estimated_cost_micros, cost_currency, pricing_version,
            started_at, finished_at)
           VALUES (?, 'fixture', 'definition', ?, ?, ?, 'failed', NULL, NULL, NULL,
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
        repository: new SqliteCleanupRepository(
          handle.client,
          [new SqliteRecruitmentCleanupParticipant(handle.client)],
          [
            new SqliteUserAgentReferenceReader(handle.client),
            new SqliteProfileDerivedDataManager(handle.client),
          ],
        ),
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
        WITH scan_input (id, source_id, trigger, status, coverage, stats_json, started_at, finished_at) AS (VALUES ('sync', 'source', 'manual', 'succeeded', 'complete', '{}', 1, 2))
INSERT INTO tasks(id,task_type,private_state,public_state,status,idempotency_key,attempt_count,max_attempts,available_at,created_at,started_at,finished_at,error_category,error_summary) SELECT id,'source.scan',json_object('sourceId',source_id,'trigger',trigger),json_object('status',status,'coverage',coverage,'stats',json(scan_input.stats_json),'coverageEvidence',json('{}')),CASE WHEN status='partial' THEN 'succeeded' ELSE status END,'source.scan:'||id,1,1,started_at,started_at,started_at,scan_input.finished_at,NULL,NULL FROM scan_input;
        INSERT INTO jobs
          (id, company_id, source_id, external_job_id, title, department, job_family,
           locations_json, employment_type, experience_text, education_text, description,
           detail_url, apply_url, published_at, status, missing_count, content_hash,
           first_seen_at, last_seen_at, closed_at, created_at, updated_at)
        VALUES ('job', 'company', 'source', 'job', 'Fixture', NULL, NULL, '[]', NULL,
                NULL, NULL, 'Fixture', 'https://careers.example.com/job',
                'https://careers.example.com/job', NULL, 'active', 0, '${'c'.repeat(64)}',
                1, 1, NULL, 1, 1);
        UPDATE jobs SET content_id='revision',content_hash='${'c'.repeat(64)}',source_payload_hash='${'b'.repeat(64)}',source_url='https://careers.example.com/job'  WHERE jobs.id='job';
        INSERT INTO job_observations (job_id, sync_run_id, observed_at)
        VALUES ('job', 'sync', 1);
        INSERT INTO source_job_details
          (source_id, external_job_id, list_content_hash, adapter_version, detail_json,
           status, fetched_at, updated_at)
        VALUES ('source', 'job', '${'c'.repeat(64)}', '1', '{}', 'succeeded', 1, 1);
      `);
      const repository = new SqliteCleanupRepository(
        handle.client,
        [new SqliteRecruitmentCleanupParticipant(handle.client)],
        [
          new SqliteUserAgentReferenceReader(handle.client),
          new SqliteProfileDerivedDataManager(handle.client),
        ],
      );
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
      expect(handle.client.prepare(`SELECT count(*) FROM jobs`).pluck().get()).toBe(1);
    } finally {
      handle.close();
      await root.cleanup();
    }
  });
});
