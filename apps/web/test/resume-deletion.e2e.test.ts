import { resolveAppConfig, resolveBootstrapConfig } from '@jobhunter/application';
import { openSqliteDatabase } from '@jobhunter/db';
import { createTemporaryDataRoot, makeCandidateProfile } from '@jobhunter/testkit';
import { describe, expect, it } from 'vitest';
import { createLocalWebContainer } from '../src/server/container.js';

const resumeId = '018f0000-0000-7000-8000-000000000801';

function seedResume(dataRoot: string): void {
  const database = openSqliteDatabase({ dataRoot });
  const profile = JSON.stringify(makeCandidateProfile());
  try {
    database.client
      .prepare(
        `INSERT INTO entities
         (id, relative_path, media_type, sha256, byte_size, created_at, deleted_at)
         VALUES ('018f0000-0000-7000-8000-000000000802',
          'artifacts/test-resume', 'text/plain', ?, 8, 1, NULL)`,
      )
      .run('a'.repeat(64));
    database.client
      .prepare(
        `INSERT INTO files
         (id, kind, name, state, revision, properties_json, created_at, updated_at)
         VALUES (?, 'resume', 'test-resume.txt', 'parsed', 0, '{}', 1, 1)`,
      )
      .run(resumeId);
    database.client
      .prepare(
        `INSERT INTO file_entity_mappings
         (file_id, entity_id, version_no, parser_version, parse_status, extracted_text,
          metadata_json, created_at)
         VALUES (?, '018f0000-0000-7000-8000-000000000802', 1, 'test-v1', 'parsed',
          'private resume text', '{}', 1)`,
      )
      .run(resumeId);
    database.client
      .prepare(
        `INSERT INTO candidate_profiles (id, name, created_at, updated_at)
         VALUES ('018f0000-0000-7000-8000-000000000803', 'Test', 1, 1)`,
      )
      .run();
    database.client
      .prepare(
        `INSERT INTO profile_versions
         (id, profile_id, version_no, resume_file_id, extracted_json, effective_json,
          locked_paths_json, content_hash, is_current, created_at)
         VALUES ('018f0000-0000-7000-8000-000000000804',
          '018f0000-0000-7000-8000-000000000803', 1, ?, ?, ?, '[]', ?, 1, 1)`,
      )
      .run(resumeId, profile, profile, 'b'.repeat(64));
  } finally {
    database.close();
  }
}

describe('Web resume deletion', () => {
  it('requires a stable preview before idempotently enqueueing deletion', async () => {
    const root = await createTemporaryDataRoot('jobhunter-web-resume-delete-');
    try {
      seedResume(root.path);
      const bootstrap = resolveBootstrapConfig({
        cli: { dataRoot: root.path },
        environment: {},
        cwd: root.path,
      });
      const container = createLocalWebContainer(
        resolveAppConfig({ bootstrap, environment: {}, file: {} }),
      );
      try {
        const impact = container.services.resumeDeletion.preview(resumeId);
        expect(impact).toMatchObject({
          resumeDocumentId: resumeId,
          counts: { profiles: 1, profileVersions: 1, resumeDocuments: 1, artifacts: 1 },
        });
        expect(JSON.stringify(impact)).not.toContain('private resume text');
        const command = {
          resumeDocumentId: resumeId,
          expectedImpactHash: impact.impactHash,
          confirmation: 'DELETE' as const,
          idempotencyToken: 'deletion-request-token',
        };
        const first = container.services.resumeDeletion.confirm(command);
        const second = container.services.resumeDeletion.confirm(command);
        expect(first).toMatchObject({ deduplicated: false, status: 'pending' });
        expect(second).toMatchObject({ taskId: first.taskId, deduplicated: true });
        expect(container.services.diagnostics.getTask(first.taskId)?.taskType).toBe(
          'resume.delete.confirmed',
        );
      } finally {
        container.close();
      }
    } finally {
      await root.cleanup();
    }
  });
});
