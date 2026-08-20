import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  ArtifactKind,
  ArtifactStore,
  QuarantinedArtifact,
  StoredArtifact,
} from '@jobhunter/application';
import { parseContentHash } from '@jobhunter/domain';
import type Database from 'better-sqlite3';
import { PersistenceError } from './errors.js';

interface ArtifactRow {
  readonly id: string;
  readonly kind: ArtifactKind;
  readonly relative_path: string;
  readonly media_type: string;
  readonly sha256: string;
  readonly byte_size: number;
  readonly created_at: number;
}

function rowToArtifact(row: ArtifactRow): StoredArtifact {
  return {
    id: row.id,
    kind: row.kind,
    relativePath: row.relative_path,
    mediaType: row.media_type,
    sha256: parseContentHash(row.sha256),
    byteSize: row.byte_size,
    createdAt: row.created_at as StoredArtifact['createdAt'],
  };
}

export class SqliteArtifactStore implements ArtifactStore {
  readonly #client: Database.Database;
  readonly #dataRoot: string;

  public constructor(client: Database.Database, dataRoot: string) {
    this.#client = client;
    this.#dataRoot = path.resolve(dataRoot);
  }

  public resolve(relativePath: string): string {
    if (!relativePath || path.isAbsolute(relativePath)) {
      throw new PersistenceError('ARTIFACT_PATH_INVALID', 'Artifact path must be relative.');
    }
    const target = path.resolve(this.#dataRoot, relativePath);
    const relation = path.relative(this.#dataRoot, target);
    if (!relation || relation.startsWith('..') || path.isAbsolute(relation)) {
      throw new PersistenceError('ARTIFACT_PATH_INVALID', 'Artifact path escapes the data root.');
    }
    return target;
  }

  public async put(input: {
    readonly id: string;
    readonly kind: ArtifactKind;
    readonly mediaType: string;
    readonly content: Uint8Array;
    readonly createdAt: StoredArtifact['createdAt'];
  }): Promise<StoredArtifact> {
    const sha256 = createHash('sha256').update(input.content).digest('hex');
    const existing = this.#client
      .prepare(
        `SELECT id, kind, relative_path, media_type, sha256, byte_size, created_at
         FROM file_artifacts WHERE sha256 = ? AND deleted_at IS NULL ORDER BY created_at LIMIT 1`,
      )
      .get(sha256) as ArtifactRow | undefined;
    if (existing) return rowToArtifact(existing);

    const relativePath = path.posix.join('artifacts', sha256.slice(0, 2), sha256);
    const target = this.resolve(relativePath);
    const directory = path.dirname(target);
    await mkdir(directory, { recursive: true });
    const temporary = path.join(directory, `.${sha256}.${randomUUID()}.tmp`);
    let createdTarget = false;

    try {
      await writeFile(temporary, input.content, { flag: 'wx' });
      try {
        await rename(temporary, target);
        createdTarget = true;
      } catch (error) {
        try {
          await access(target);
          await rm(temporary, { force: true });
        } catch {
          throw error;
        }
      }

      this.#client
        .prepare(
          `INSERT INTO file_artifacts
           (id, kind, relative_path, media_type, sha256, byte_size, created_at, deleted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
           ON CONFLICT(relative_path) DO NOTHING`,
        )
        .run(
          input.id,
          input.kind,
          relativePath,
          input.mediaType,
          sha256,
          input.content.byteLength,
          input.createdAt,
        );
      const stored = this.#client
        .prepare(
          `SELECT id, kind, relative_path, media_type, sha256, byte_size, created_at
           FROM file_artifacts WHERE relative_path = ?`,
        )
        .get(relativePath) as ArtifactRow | undefined;
      if (!stored) throw new Error('Artifact registration did not produce a row.');
      return rowToArtifact(stored);
    } catch (error) {
      await rm(temporary, { force: true });
      if (createdTarget) {
        const registered = this.#client
          .prepare('SELECT 1 FROM file_artifacts WHERE relative_path = ?')
          .get(relativePath);
        if (!registered) await rm(target, { force: true });
      }
      throw error;
    }
  }

  public async quarantine(artifactId: string, relativePath: string): Promise<QuarantinedArtifact> {
    if (!artifactId.trim()) {
      throw new PersistenceError('ARTIFACT_PATH_INVALID', 'Artifact ID must not be empty.');
    }
    const original = this.resolve(relativePath);
    const quarantinedRelativePath = path.posix.join(
      'deleted-artifacts',
      artifactId,
      path.posix.basename(relativePath.replaceAll('\\', '/')),
    );
    const quarantined = this.resolve(quarantinedRelativePath);
    await mkdir(path.dirname(quarantined), { recursive: true });
    let fileExisted = true;
    try {
      await rename(original, quarantined);
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      try {
        await access(quarantined);
      } catch {
        fileExisted = false;
      }
    }
    return {
      artifactId,
      originalRelativePath: relativePath,
      quarantinedRelativePath,
      fileExisted,
    };
  }

  public async restoreQuarantined(artifact: QuarantinedArtifact): Promise<void> {
    if (!artifact.fileExisted) return;
    const source = this.resolve(artifact.quarantinedRelativePath);
    const target = this.resolve(artifact.originalRelativePath);
    await mkdir(path.dirname(target), { recursive: true });
    try {
      await rename(source, target);
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      await access(target);
    }
  }

  public async purgeQuarantined(artifact: QuarantinedArtifact): Promise<void> {
    await rm(this.resolve(artifact.quarantinedRelativePath), { force: true });
  }
}
