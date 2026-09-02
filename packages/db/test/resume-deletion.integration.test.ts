import { access } from 'node:fs/promises';
import {
  ResumeDeletionConfirmationError,
  ResumeDeletionService,
  type ArtifactStore,
  type QuarantinedArtifact,
  type ResumeDeletionRepository,
  type ResumeDeletionSnapshot,
  type StoredArtifact,
  type StoredArtifactContent,
} from '@jobhunter/application';
import { utcInstant, type Clock, type UtcInstant } from '@jobhunter/domain';
import { createTemporaryDataRoot } from '@jobhunter/testkit';
import { afterEach, describe, expect, it } from 'vitest';
import {
  openSqliteDatabase,
  SqliteArtifactStore,
  SqliteResumeDeletionRepository,
  type SqliteDatabaseHandle,
} from '../src/index.js';

class FixedClock implements Clock {
  public now(): UtcInstant {
    return utcInstant(1_800_000_000_000);
  }
}

class FailOncePurgeStore implements ArtifactStore {
  readonly #delegate: ArtifactStore;
  #shouldFail = true;

  public constructor(delegate: ArtifactStore) {
    this.#delegate = delegate;
  }

  public put(input: Parameters<ArtifactStore['put']>[0]): Promise<StoredArtifact> {
    return this.#delegate.put(input);
  }

  public read(input: Parameters<ArtifactStore['read']>[0]): Promise<StoredArtifactContent> {
    return this.#delegate.read(input);
  }

  public resolve(relativePath: string): string {
    return this.#delegate.resolve(relativePath);
  }

  public quarantine(artifactId: string, relativePath: string): Promise<QuarantinedArtifact> {
    return this.#delegate.quarantine(artifactId, relativePath);
  }

  public restoreQuarantined(artifact: QuarantinedArtifact): Promise<void> {
    return this.#delegate.restoreQuarantined(artifact);
  }

  public purgeQuarantined(artifact: QuarantinedArtifact): Promise<void> {
    if (this.#shouldFail) {
      this.#shouldFail = false;
      return Promise.reject(new Error('Injected purge failure.'));
    }
    return this.#delegate.purgeQuarantined(artifact);
  }
}

class ImpactChangingRepository implements ResumeDeletionRepository {
  readonly #delegate: ResumeDeletionRepository;
  readonly #client: SqliteDatabaseHandle['client'];

  public constructor(delegate: ResumeDeletionRepository, client: SqliteDatabaseHandle['client']) {
    this.#delegate = delegate;
    this.#client = client;
  }

  public preview(resumeDocumentId: string): ResumeDeletionSnapshot | null {
    return this.#delegate.preview(resumeDocumentId);
  }

  public applyConfirmedDeletion(
    input: Parameters<ResumeDeletionRepository['applyConfirmedDeletion']>[0],
  ): void {
    this.#client
      .prepare(
        `INSERT INTO candidate_profiles (id, name, created_at, updated_at)
         VALUES ('profile-three', 'profile-three', 1, 1)`,
      )
      .run();
    this.#client
      .prepare(
        `INSERT INTO profile_versions
         (id, profile_id, version_no, resume_file_id, agent_run_id, extracted_json,
          effective_json, locked_paths_json, content_hash, is_current, created_at)
         VALUES ('version-three', 'profile-three', 1, 'document-one', 'shared-agent-run',
                 '{}', '{}', '[]', 'profile-three-hash', 1, 1)`,
      )
      .run();
    this.#delegate.applyConfirmedDeletion(input);
  }

  public getDeletedArtifact(
    artifactId: string,
  ): ResumeDeletionSnapshot['artifacts'][number] | null {
    return this.#delegate.getDeletedArtifact(artifactId);
  }

  public removePurgedArtifact(artifactId: string): void {
    this.#delegate.removePurgedArtifact(artifactId);
  }
}

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

async function setup(options: { readonly failFirstPurge?: boolean } = {}): Promise<{
  readonly handle: SqliteDatabaseHandle;
  readonly artifacts: ArtifactStore;
  readonly service: ResumeDeletionService;
  readonly originalPaths: readonly string[];
  readonly entityIds: readonly string[];
}> {
  const root = await createTemporaryDataRoot('jobhunter-resume-delete-');
  const handle = openSqliteDatabase({ dataRoot: root.path });
  resources.push({ root, handle });
  const sqliteArtifacts = new SqliteArtifactStore(handle.client, root.path);
  const first = await sqliteArtifacts.put({
    id: 'document-one',
    kind: 'resume',
    mediaType: 'text/plain',
    content: new TextEncoder().encode('first redacted resume body'),
    createdAt: utcInstant(1),
  });
  const second = await sqliteArtifacts.put({
    id: 'document-two',
    kind: 'resume',
    mediaType: 'text/plain',
    content: new TextEncoder().encode('second redacted resume body'),
    createdAt: utcInstant(2),
  });
  const avatar = await sqliteArtifacts.put({
    id: 'draft-avatar',
    kind: 'resume_avatar',
    mediaType: 'image/png',
    content: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1]),
    createdAt: utcInstant(3),
    logicalFile: 'new',
  });
  const exportInput = await sqliteArtifacts.put({
    id: 'draft-export-input',
    kind: 'export',
    mediaType: 'text/html',
    content: new TextEncoder().encode('<html>resume export input</html>'),
    createdAt: utcInstant(4),
    logicalFile: 'new',
  });
  const exportOutput = await sqliteArtifacts.put({
    id: 'draft-export-output',
    kind: 'export',
    mediaType: 'application/pdf',
    content: new TextEncoder().encode('redacted pdf output'),
    createdAt: utcInstant(5),
    logicalFile: 'new',
  });
  handle.client
    .prepare("UPDATE files SET state = 'parsed' WHERE id IN ('document-one', 'document-two')")
    .run();
  handle.client
    .prepare(
      `UPDATE file_entity_mappings
       SET parser_version = 'utf8@1', parse_status = 'parsed', extracted_text = ?
       WHERE file_id = ?`,
    )
    .run('redacted extracted text', 'document-one');
  handle.client
    .prepare(
      `UPDATE file_entity_mappings
       SET parser_version = 'utf8@1', parse_status = 'parsed', extracted_text = ?
       WHERE file_id = ?`,
    )
    .run('new redacted extracted text', 'document-two');
  handle.client
    .prepare(
      `INSERT INTO agent_runs
       (id, agent_key, agent_version, prompt_version, model_config_hash, input_hash,
        cache_key, status, output_json, cost_currency, pricing_version, started_at, finished_at)
       VALUES ('shared-agent-run', 'resume-profile', '1', '1', ?, ?, 'shared-cache',
               'succeeded', '{"redacted":true}', 'USD', 'test', 1, 2)`,
    )
    .run('a'.repeat(64), 'b'.repeat(64));
  for (const [profileId, versionId, documentId, versionNo] of [
    ['profile-one', 'version-one', 'document-one', 1],
    ['profile-two', 'version-two', 'document-two', 1],
  ] as const) {
    handle.client
      .prepare(
        'INSERT INTO candidate_profiles (id, name, created_at, updated_at) VALUES (?, ?, 1, 1)',
      )
      .run(profileId, profileId);
    handle.client
      .prepare(
        `INSERT INTO profile_versions
         (id, profile_id, version_no, resume_file_id, agent_run_id, extracted_json,
          effective_json, locked_paths_json, content_hash, is_current, created_at)
         VALUES (?, ?, ?, ?, 'shared-agent-run', '{}', '{}', '[]', ?, 1, 1)`,
      )
      .run(versionId, profileId, versionNo, documentId, `${profileId}-hash`);
  }
  handle.client
    .prepare(
      `INSERT INTO resume_template_drafts
     (id, profile_id, template_key, template_version, source_profile_version_id,
      content_json, avatar_file_id, avatar_file_version, revision, created_at, updated_at)
     VALUES ('draft-one', 'profile-one', 'technical-blueprint', 1, 'version-one',
      '{}', ?, ?, 0, 1, 1)`,
    )
    .run(avatar.id, avatar.versionNo);
  handle.client
    .prepare(
      `INSERT INTO resume_export_requests
     (id, draft_id, format, draft_revision, input_file_id, input_file_version,
      output_file_id, output_file_version, status, file_name, expires_at, created_at, updated_at)
     VALUES ('export-one', 'draft-one', 'pdf', 0, ?, ?, ?, ?, 'succeeded',
      'resume.pdf', 9999999999999, 1, 1)`,
    )
    .run(exportInput.id, exportInput.versionNo, exportOutput.id, exportOutput.versionNo);
  const artifacts: ArtifactStore = options.failFirstPurge
    ? new FailOncePurgeStore(sqliteArtifacts)
    : sqliteArtifacts;
  return {
    handle,
    artifacts,
    service: new ResumeDeletionService({
      repository: new SqliteResumeDeletionRepository(handle.client),
      artifacts,
      clock: new FixedClock(),
    }),
    originalPaths: [
      sqliteArtifacts.resolve(first.relativePath),
      sqliteArtifacts.resolve(second.relativePath),
      sqliteArtifacts.resolve(avatar.relativePath),
      sqliteArtifacts.resolve(exportInput.relativePath),
      sqliteArtifacts.resolve(exportOutput.relativePath),
    ],
    entityIds: [
      first.entityId,
      second.entityId,
      avatar.entityId,
      exportInput.entityId,
      exportOutput.entityId,
    ],
  };
}

describe('resume sensitive-data deletion', () => {
  it('previews the complete shared-cache closure and requires the exact impact hash', async () => {
    const { handle, service, originalPaths } = await setup();
    const preview = service.preview('document-one');
    expect(preview.counts).toEqual({
      profiles: 2,
      profileVersions: 2,
      resumeDocuments: 2,
      matchResults: 0,
      agentRuns: 1,
      artifacts: 5,
      resumeDrafts: 1,
      resumeExports: 1,
    });
    expect(preview.snapshot.profileIds).toEqual(['profile-one', 'profile-two']);
    await expect(
      service.deleteConfirmed({
        resumeDocumentId: 'document-one',
        expectedImpactHash: '0'.repeat(64),
      }),
    ).rejects.toBeInstanceOf(ResumeDeletionConfirmationError);
    expect(handle.client.prepare('SELECT count(*) FROM candidate_profiles').pluck().get()).toBe(2);
    await expect(access(originalPaths[0] ?? '')).resolves.toBeUndefined();
  });

  it('quarantines files, deletes sensitive relations and purges artifact tombstones', async () => {
    const { handle, service, originalPaths } = await setup();
    const preview = service.preview('document-one');
    const result = await service.deleteConfirmed({
      resumeDocumentId: 'document-one',
      expectedImpactHash: preview.impactHash,
    });

    expect(result.pendingArtifactPurgeIds).toEqual([]);
    for (const table of [
      'candidate_profiles',
      'profile_versions',
      'agent_runs',
      'resume_template_drafts',
      'resume_export_requests',
      'files',
      'entities',
    ]) {
      expect(handle.client.prepare(`SELECT count(*) FROM ${table}`).pluck().get()).toBe(0);
    }
    for (const originalPath of originalPaths) {
      await expect(access(originalPath)).rejects.toMatchObject({ code: 'ENOENT' });
    }
    const audit = handle.client
      .prepare(
        `SELECT event_type, stream_id AS subject_hash, payload_json AS details_json,
                occurred_at AS created_at
         FROM events WHERE stream_type = 'operation'`,
      )
      .get() as {
      readonly event_type: string;
      readonly subject_hash: string;
      readonly details_json: string;
      readonly created_at: number;
    };
    expect(audit).toMatchObject({
      event_type: 'resume.deleted',
      subject_hash: preview.impactHash,
      created_at: 1_800_000_000_000,
    });
    expect(JSON.parse(audit.details_json)).toEqual({ counts: result.deleted });
    const serializedAudit = JSON.stringify(audit);
    for (const sensitive of [
      'document-one',
      'profile-one',
      'first redacted resume body',
      'redacted extracted text',
    ]) {
      expect(serializedAudit).not.toContain(sensitive);
    }
  });

  it('keeps a tombstone after purge failure and supports an idempotent purge retry', async () => {
    const { handle, service, entityIds } = await setup({ failFirstPurge: true });
    const preview = service.preview('document-one');
    const result = await service.deleteConfirmed({
      resumeDocumentId: 'document-one',
      expectedImpactHash: preview.impactHash,
    });
    expect(result.pendingArtifactPurgeIds).toHaveLength(1);
    const pendingEntityId = result.pendingArtifactPurgeIds[0] ?? '';
    expect(entityIds).toContain(pendingEntityId);
    expect(
      handle.client
        .prepare('SELECT deleted_at, relative_path FROM entities WHERE id = ?')
        .get(pendingEntityId),
    ).toMatchObject({ deleted_at: 1_800_000_000_000 });

    await expect(service.retryArtifactPurge(pendingEntityId)).resolves.toBe('purged');
    await expect(service.retryArtifactPurge(pendingEntityId)).resolves.toBe('already_purged');
    expect(handle.client.prepare('SELECT count(*) FROM entities').pluck().get()).toBe(0);
  });

  it('restores quarantined files when the database impact changes before commit', async () => {
    const { handle, artifacts, originalPaths } = await setup();
    const repository = new ImpactChangingRepository(
      new SqliteResumeDeletionRepository(handle.client),
      handle.client,
    );
    const service = new ResumeDeletionService({
      repository,
      artifacts,
      clock: new FixedClock(),
    });
    const preview = service.preview('document-one');

    await expect(
      service.deleteConfirmed({
        resumeDocumentId: 'document-one',
        expectedImpactHash: preview.impactHash,
      }),
    ).rejects.toThrow(/impact changed/);
    for (const originalPath of originalPaths) {
      await expect(access(originalPath)).resolves.toBeUndefined();
    }
    expect(
      handle.client.prepare('SELECT count(*) FROM entities WHERE deleted_at IS NULL').pluck().get(),
    ).toBe(5);
    expect(
      handle.client.prepare("SELECT count(*) FROM files WHERE kind = 'resume'").pluck().get(),
    ).toBe(2);
    expect(
      handle.client
        .prepare("SELECT count(*) FROM events WHERE stream_type = 'operation'")
        .pluck()
        .get(),
    ).toBe(0);
  });
});
