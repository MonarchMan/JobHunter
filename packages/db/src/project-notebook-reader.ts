import type { ProjectNotebookReader } from '@jobhunter/application';
import type Database from 'better-sqlite3';
import { open } from 'node:fs/promises';
import path from 'node:path';
import { PersistenceError } from './errors.js';

interface ArtifactRow {
  readonly relative_path: string;
  readonly byte_size: number;
  readonly media_type: string;
}

export class SqliteProjectNotebookReader implements ProjectNotebookReader {
  readonly #client: Database.Database;
  readonly #dataRoot: string;

  public constructor(client: Database.Database, dataRoot: string) {
    this.#client = client;
    this.#dataRoot = path.resolve(dataRoot);
  }

  public async read(
    artifactId: string,
    maximumBytes: number,
    signal: AbortSignal,
  ): Promise<{ readonly content: Uint8Array; readonly mediaType: string }> {
    if (signal.aborted) throw new DOMException('Notebook read was aborted.', 'AbortError');
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
      throw new TypeError('Maximum notebook byte size must be a positive safe integer.');
    }
    const row = this.#client
      .prepare(
        `SELECT artifact.relative_path, artifact.byte_size, artifact.media_type
         FROM file_artifacts artifact
         JOIN project_dossiers dossier ON dossier.latest_notebook_artifact_id = artifact.id
         WHERE artifact.id = ? AND artifact.kind = 'export' AND artifact.deleted_at IS NULL`,
      )
      .get(artifactId) as ArtifactRow | undefined;
    if (!row) throw new TypeError('Project notebook was not found.');
    if (row.byte_size < 1 || row.byte_size > maximumBytes) {
      throw new TypeError('Project notebook size is invalid.');
    }
    const target = path.resolve(this.#dataRoot, row.relative_path);
    const relation = path.relative(this.#dataRoot, target);
    if (!relation || relation.startsWith('..') || path.isAbsolute(relation)) {
      throw new PersistenceError('ARTIFACT_PATH_INVALID', 'Artifact path escapes the data root.');
    }
    const file = await open(target, 'r');
    try {
      const metadata = await file.stat();
      if (!metadata.isFile() || metadata.size !== row.byte_size) {
        throw new TypeError('Project notebook does not match its stored metadata.');
      }
      return {
        content: new Uint8Array(await file.readFile({ signal })),
        mediaType: row.media_type,
      };
    } finally {
      await file.close();
    }
  }
}
