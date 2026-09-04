import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, mkdir, open, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  ArtifactKind,
  ArtifactStore,
  QuarantinedArtifact,
  StoredArtifact,
  StoredArtifactContent,
} from '@jobhunter/application';
import { parseContentHash } from '@jobhunter/domain';
import type Database from 'better-sqlite3';
import { PersistenceError } from './errors.js';

/** 数据库查询结果对应的行结构。 */
interface ArtifactRow {
  readonly id: string;
  readonly entity_id: string;
  readonly version_no: number;
  readonly kind: ArtifactKind;
  readonly relative_path: string;
  readonly media_type: string;
  readonly sha256: string;
  readonly byte_size: number;
  readonly created_at: number;
}

/** 数据库查询结果对应的行结构。 */
interface ArtifactContentRow {
  readonly relative_path: string;
  readonly media_type: string;
  readonly sha256: string;
  readonly byte_size: number;
}

/** 执行数据库结果的解析、转换或持久化辅助逻辑。 */
function rowToArtifact(row: ArtifactRow): StoredArtifact {
  return {
    id: row.id,
    entityId: row.entity_id,
    versionNo: row.version_no,
    kind: row.kind,
    relativePath: row.relative_path,
    mediaType: row.media_type,
    sha256: parseContentHash(row.sha256),
    byteSize: row.byte_size,
    createdAt: row.created_at as StoredArtifact['createdAt'],
  };
}

/** 基于 files/entities 映射持久化物理文件，并执行版本上限与幂等复用。 */
export class SqliteArtifactStore implements ArtifactStore {
  readonly #client: Database.Database;
  readonly #dataRoot: string;

  public constructor(client: Database.Database, dataRoot: string) {
    this.#client = client;
    this.#dataRoot = path.resolve(dataRoot);
  }

  /** 执行数据库组件对外暴露的操作。 */
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

  /** 执行数据库组件对外暴露的操作。 */
  public async put(input: {
    readonly id: string;
    readonly kind: ArtifactKind;
    readonly name?: string;
    readonly mediaType: string;
    readonly content: Uint8Array;
    readonly createdAt: StoredArtifact['createdAt'];
    readonly logicalFile?: 'reuse' | 'new';
  }): Promise<StoredArtifact> {
    const sha256 = createHash('sha256').update(input.content).digest('hex');
    const existingEntity = this.#client
      .prepare(
        `SELECT id, relative_path, media_type, sha256, byte_size, created_at
         FROM entities WHERE sha256 = ? AND deleted_at IS NULL ORDER BY created_at LIMIT 1`,
      )
      .get(sha256) as
      | (Omit<ArtifactRow, 'id' | 'entity_id' | 'kind' | 'version_no'> & {
          readonly id: string;
        })
      | undefined;

    const relativePath = path.posix.join('artifacts', sha256.slice(0, 2), sha256);
    const target = this.resolve(relativePath);
    const directory = path.dirname(target);
    const temporary = path.join(directory, `.${sha256}.${randomUUID()}.tmp`);
    let createdTarget = false;
    const entityId = existingEntity?.id ?? randomUUID();
    let storedFileId = input.id;
    const requestedName = input.name?.trim();

    try {
      if (!existingEntity) {
        await mkdir(directory, { recursive: true });
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
      }

      this.#client.transaction(() => {
        this.#client
          .prepare(
            `INSERT INTO entities
             (id, relative_path, media_type, sha256, byte_size, created_at, deleted_at)
             VALUES (?, ?, ?, ?, ?, ?, NULL)
             ON CONFLICT(sha256) WHERE deleted_at IS NULL DO NOTHING`,
          )
          .run(
            entityId,
            relativePath,
            input.mediaType,
            sha256,
            input.content.byteLength,
            input.createdAt,
          );
        const registeredEntityId = this.#client
          .prepare('SELECT id FROM entities WHERE sha256 = ? AND deleted_at IS NULL')
          .pluck()
          .get(sha256) as string | undefined;
        if (!registeredEntityId) throw new Error('File entity registration did not produce a row.');
        const requested = this.#client
          .prepare('SELECT kind FROM files WHERE id = ?')
          .get(input.id) as { readonly kind: string } | undefined;
        if (requested && requested.kind !== input.kind) {
          throw new TypeError('Logical file kind does not match the requested artifact kind.');
        }
        if (!requested && input.logicalFile !== 'new') {
          storedFileId =
            (this.#client
              .prepare(
                `SELECT file.id FROM files file
                 JOIN file_entity_mappings version ON version.file_id = file.id
                 WHERE file.kind = ? AND version.entity_id = ?
                 ORDER BY file.created_at, file.id LIMIT 1`,
              )
              .pluck()
              .get(input.kind, registeredEntityId) as string | undefined) ?? input.id;
        }
        this.#client
          .prepare(
            `INSERT INTO files
             (id, kind, name, state, revision, properties_json, created_at, updated_at)
             VALUES (?, ?, ?, 'stored', 0, '{}', ?, ?)
             ON CONFLICT(id) DO NOTHING`,
          )
          .run(
            storedFileId,
            input.kind,
            requestedName === undefined || requestedName.length === 0
              ? `${input.kind}-${storedFileId}`
              : requestedName,
            input.createdAt,
            input.createdAt,
          );
        const existingVersion = this.#client
          .prepare(
            `SELECT version_no FROM file_entity_mappings WHERE file_id = ? AND entity_id = ?`,
          )
          .pluck()
          .get(storedFileId, registeredEntityId) as number | undefined;
        if (existingVersion === undefined) {
          const nextVersion = Number(
            this.#client
              .prepare(
                'SELECT COALESCE(MAX(version_no), 0) + 1 FROM file_entity_mappings WHERE file_id = ?',
              )
              .pluck()
              .get(storedFileId),
          );
          this.#client
            .prepare(
              `INSERT INTO file_entity_mappings
               (file_id, entity_id, version_no, metadata_json, created_at)
               VALUES (?, ?, ?, '{}', ?)`,
            )
            .run(storedFileId, registeredEntityId, nextVersion, input.createdAt);
        }
      })();
      const stored = this.#client
        .prepare(
          `SELECT file.id, file.kind, entity.id AS entity_id, version.version_no,
                  entity.relative_path, entity.media_type, entity.sha256, entity.byte_size,
                  entity.created_at
           FROM files file
           JOIN file_entity_mappings version ON version.file_id = file.id
           JOIN entities entity ON entity.id = version.entity_id
           WHERE file.id = ? AND entity.sha256 = ?
           ORDER BY version.version_no DESC LIMIT 1`,
        )
        .get(storedFileId, sha256) as ArtifactRow | undefined;
      if (!stored) throw new Error('Artifact registration did not produce a row.');
      return rowToArtifact(stored);
    } catch (error) {
      await rm(temporary, { force: true });
      if (createdTarget) {
        const registered = this.#client
          .prepare('SELECT 1 FROM entities WHERE relative_path = ?')
          .get(relativePath);
        if (!registered) await rm(target, { force: true });
      }
      throw error;
    }
  }

  /** 执行数据库组件对外暴露的操作。 */
  public async read(input: {
    readonly id: string;
    readonly versionNo: number;
    readonly kind: ArtifactKind;
    readonly maximumBytes: number;
    readonly signal?: AbortSignal;
  }): Promise<StoredArtifactContent> {
    if (!input.id.trim()) throw new TypeError('Artifact ID must not be empty.');
    if (!Number.isSafeInteger(input.versionNo) || input.versionNo < 1 || input.versionNo > 5) {
      throw new TypeError('Artifact version number is invalid.');
    }
    if (!Number.isSafeInteger(input.maximumBytes) || input.maximumBytes < 1) {
      throw new TypeError('Artifact byte limit must be a positive safe integer.');
    }
    if (input.signal?.aborted) {
      throw new DOMException('Artifact read was aborted.', 'AbortError');
    }
    const row = this.#client
      .prepare(
        `SELECT entity.relative_path, entity.media_type, entity.sha256, entity.byte_size
         FROM files file
         JOIN file_entity_mappings version ON version.file_id = file.id
         JOIN entities entity ON entity.id = version.entity_id
         WHERE file.id = ? AND file.kind = ? AND version.version_no = ?
           AND entity.deleted_at IS NULL
         LIMIT 1`,
      )
      .get(input.id, input.kind, input.versionNo) as ArtifactContentRow | undefined;
    if (!row) throw new TypeError('Artifact version was not found.');
    if (row.byte_size < 1 || row.byte_size > input.maximumBytes) {
      throw new TypeError('Artifact version size is invalid.');
    }
    const target = this.resolve(row.relative_path);
    const file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const metadata = await file.stat();
      if (!metadata.isFile() || metadata.size !== row.byte_size) {
        throw new TypeError('Artifact version does not match its stored metadata.');
      }
      const bytes = new Uint8Array(await file.readFile({ signal: input.signal }));
      const hash = createHash('sha256').update(bytes).digest('hex');
      if (hash !== row.sha256) {
        throw new TypeError('Artifact version content hash does not match its stored metadata.');
      }
      return {
        content: bytes,
        mediaType: row.media_type,
        sha256: parseContentHash(row.sha256),
      };
    } finally {
      await file.close();
    }
  }

  /** 执行数据库组件对外暴露的操作。 */
  public async remove(input: { readonly id: string; readonly kind: ArtifactKind }): Promise<void> {
    const rows = this.#client
      .prepare(
        `SELECT entity.id, entity.relative_path
         FROM files file
         JOIN file_entity_mappings mapping ON mapping.file_id = file.id
         JOIN entities entity ON entity.id = mapping.entity_id
         WHERE file.id = ? AND file.kind = ?`,
      )
      .all(input.id, input.kind) as { readonly id: string; readonly relative_path: string }[];
    this.#client.transaction(() => {
      this.#client.prepare('DELETE FROM files WHERE id = ? AND kind = ?').run(input.id, input.kind);
      for (const row of rows) {
        this.#client
          .prepare(
            `DELETE FROM entities WHERE id = ?
             AND NOT EXISTS (SELECT 1 FROM file_entity_mappings WHERE entity_id = ?)`,
          )
          .run(row.id, row.id);
      }
    })();
    for (const row of rows) {
      const stillRegistered = this.#client
        .prepare('SELECT 1 FROM entities WHERE id = ?')
        .get(row.id);
      if (!stillRegistered) await rm(this.resolve(row.relative_path), { force: true });
    }
  }

  /** 执行数据库组件对外暴露的操作。 */
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

  /** 执行数据库组件对外暴露的操作。 */
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

  /** 执行数据库组件对外暴露的操作。 */
  public async purgeQuarantined(artifact: QuarantinedArtifact): Promise<void> {
    await rm(this.resolve(artifact.quarantinedRelativePath), { force: true });
  }
}
