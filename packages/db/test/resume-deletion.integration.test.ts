import { access } from 'node:fs/promises';
import {
  ResumeDeletionConfirmationError,
  ResumeDeletionService,
  type ArtifactStore,
  type QuarantinedArtifact,
  type ResumeDeletionRepository,
  type ResumeDeletionSnapshot,
  type StoredArtifact,
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
         (id, profile_id, version_no, resume_document_id, agent_run_id, extracted_json,
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
}> {
  const root = await createTemporaryDataRoot('jobhunter-resume-delete-');
  const handle = openSqliteDatabase({ dataRoot: root.path });
  resources.push({ root, handle });
  const sqliteArtifacts = new SqliteArtifactStore(handle.client, root.path);
  const first = await sqliteArtifacts.put({
    id: 'artifact-one',
    kind: 'resume',
    mediaType: 'text/plain',
    content: new TextEncoder().encode('first redacted resume body'),
    createdAt: utcInstant(1),
  });
  const second = await sqliteArtifacts.put({
    id: 'artifact-two',
    kind: 'resume',
    mediaType: 'text/plain',
    content: new TextEncoder().encode('second redacted resume body'),
    createdAt: utcInstant(2),
  });
  handle.client
    .prepare(
      `INSERT INTO resume_documents
       (id, artifact_id, content_hash, media_type, extracted_text, parse_status,
        parser_version, error_summary, created_at)
       VALUES (?, ?, ?, 'text/plain', 'redacted extracted text', 'parsed', 'utf8@1', NULL, ?)`,
    )
    .run('document-one', first.id, first.sha256, 1);
  handle.client
    .prepare(
      `INSERT INTO resume_documents
       (id, artifact_id, content_hash, media_type, extracted_text, parse_status,
        parser_version, error_summary, created_at)
       VALUES (?, ?, ?, 'text/plain', 'new redacted extracted text', 'parsed', 'utf8@1', NULL, ?)`,
    )
    .run('document-two', second.id, second.sha256, 2);
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
         (id, profile_id, version_no, resume_document_id, agent_run_id, extracted_json,
          effective_json, locked_paths_json, content_hash, is_current, created_at)
         VALUES (?, ?, ?, ?, 'shared-agent-run', '{}', '{}', '[]', ?, 1, 1)`,
      )
      .run(versionId, profileId, versionNo, documentId, `${profileId}-hash`);
  }
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
      artifacts: 2,
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
      'resume_documents',
      'agent_runs',
      'file_artifacts',
    ]) {
      expect(handle.client.prepare(`SELECT count(*) FROM ${table}`).pluck().get()).toBe(0);
    }
    for (const originalPath of originalPaths) {
      await expect(access(originalPath)).rejects.toMatchObject({ code: 'ENOENT' });
    }
    const audit = handle.client
      .prepare(
        `SELECT event_type, subject_hash, details_json, created_at
         FROM operation_audit_events`,
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
    const { handle, service } = await setup({ failFirstPurge: true });
    const preview = service.preview('document-one');
    const result = await service.deleteConfirmed({
      resumeDocumentId: 'document-one',
      expectedImpactHash: preview.impactHash,
    });
    expect(result.pendingArtifactPurgeIds).toEqual(['artifact-one']);
    expect(
      handle.client
        .prepare('SELECT deleted_at, relative_path FROM file_artifacts WHERE id = ?')
        .get('artifact-one'),
    ).toMatchObject({ deleted_at: 1_800_000_000_000 });

    await expect(service.retryArtifactPurge('artifact-one')).resolves.toBe('purged');
    await expect(service.retryArtifactPurge('artifact-one')).resolves.toBe('already_purged');
    expect(handle.client.prepare('SELECT count(*) FROM file_artifacts').pluck().get()).toBe(0);
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
      handle.client
        .prepare('SELECT count(*) FROM file_artifacts WHERE deleted_at IS NULL')
        .pluck()
        .get(),
    ).toBe(2);
    expect(handle.client.prepare('SELECT count(*) FROM resume_documents').pluck().get()).toBe(2);
    expect(handle.client.prepare('SELECT count(*) FROM operation_audit_events').pluck().get()).toBe(
      0,
    );
  });
});
